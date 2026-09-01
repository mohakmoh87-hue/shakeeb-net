import crypto from "node:crypto";
import { fetch as undiciFetch, Agent } from "undici";

// وكيل يتجاهل شهادة SSL الموقّعة ذاتياً (شائع في خوادم SAS4)
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// عميل SAS4 (SAS Radius v4) — يدخل اللوحة ويسحب المشتركين
// البيانات مشفّرة AES-256-CBC بصيغة OpenSSL "Salted__" وملفوفة بحقل payload.

const AES_KEY = "abcdefghijuklmno0123456789012345";

// اشتقاق المفتاح (EVP_BytesToKey/MD5) المتوافق مع OpenSSL/CryptoJS
function evpKDF(pass: string, salt: Buffer) {
  let salted = Buffer.alloc(0);
  let dx = Buffer.alloc(0);
  while (salted.length < 48) {
    dx = crypto.createHash("md5").update(Buffer.concat([dx, Buffer.from(pass), salt])).digest();
    salted = Buffer.concat([salted, dx]);
  }
  return { key: salted.subarray(0, 32), iv: salted.subarray(32, 48) };
}
function aesEncrypt(data: string): string {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpKDF(AES_KEY, salt);
  const c = crypto.createCipheriv("aes-256-cbc", key, iv);
  const ct = Buffer.concat([c.update(data, "utf8"), c.final()]);
  return Buffer.concat([Buffer.from("Salted__"), salt, ct]).toString("base64");
}

// اشتقاق قاعدة الـ API من عنوان اللوحة المخزّن في المكتب
export function sasBaseUrl(loginUrl: string): string {
  let host = loginUrl.trim();
  host = host.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/#.*$/, "");
  return `https://${host}/admin/api/index.php/api/`;
}

async function sasPost(base: string, route: string, payload: unknown, token?: string) {
  const res = await undiciFetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ payload: aesEncrypt(JSON.stringify(payload)) }),
    dispatcher: insecureAgent,
  });
  const text = await res.text();
  return { status: res.status, text };
}

// تسجيل الدخول → توكن JWT
export async function sasLogin(base: string, username: string, password: string): Promise<string> {
  const r = await sasPost(base, "login", { username, password });
  let token: string | undefined;
  try {
    token = JSON.parse(r.text)?.token;
  } catch {
    /* ignore */
  }
  if (!token) throw new Error("فشل تسجيل الدخول إلى SAS4 (تحقق من الرابط واليوزر والباسورد)");
  return token;
}

export interface SasUser {
  sasId: number;
  username: string;
  name: string | null;
  phone: string | null;
  address: string | null; // «ادرس 1» من ملفّ المشترك في SAS (مثل «902 ع 3 ش9») — طلب محمد 2026-08-09
  expiration: string | null; // تاريخ الانتهاء
  days: number; // الأيام المتبقية
  packageName: string | null;
  groupName: string | null;
  enabled: boolean;
}

function normalize(u: Record<string, unknown>): SasUser {
  const exp = (u.expiration as string) || null;
  let days = 0;
  if (exp) {
    // فرق أيام التقويم (يقبل السالب للمنتهين منذ مدة)
    const now = new Date();
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const e = new Date(exp);
    const expMid = new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime();
    days = Math.round((expMid - todayMid) / 86400000);
  }
  const profile = u.profile_details as { name?: string } | undefined;
  const group = u.group_details as { group_name?: string } | undefined;
  // دمج الاسم الأول والثاني في اسم واحد (مثال: "علي" + "محمد جاسم" → "علي محمد جاسم")
  const firstName = ((u.firstname as string) || "").trim();
  const lastName = ((u.lastname as string) || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
  return {
    sasId: Number(u.id),
    username: String(u.username ?? ""),
    name: fullName,
    phone: (u.phone as string) || null,
    address: ((u.address as string) || "").trim() || null,
    expiration: exp,
    days,
    packageName: profile?.name ?? null,
    groupName: group?.group_name ?? null,
    enabled: Number(u.enabled) === 1,
  };
}

// جلب صفحة واحدة مع إعادة محاولة (count = حجم الصفحة: 10/50/100/500)
async function fetchUserPage(base: string, token: string, page: number, count = 10) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await sasPost(base, "index/user", { page, count }, token);
      return JSON.parse(raw.text);
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1)); // تراجع تدريجي
    }
  }
  throw lastErr;
}

// تحليل استجابة index/user الخام إلى قائمة مشتركين (لالتقاط ما تعرضه اللوحة)
export function parseUsersList(jsonText: string): SasUser[] {
  try {
    const j = JSON.parse(jsonText);
    const data = Array.isArray(j) ? j : j.data;
    if (!Array.isArray(data)) return [];
    return data.map((u) => normalize(u as Record<string, unknown>));
  } catch {
    return [];
  }
}

// جلب صفحة واحدة بحجم محدّد (يطابق ما يعرضه SAS4)
export async function sasFetchOnePage(
  base: string,
  token: string,
  page: number,
  count: number,
): Promise<{ users: SasUser[]; total: number; lastPage: number }> {
  const j = await fetchUserPage(base, token, page, count);
  const total: number = j.total ?? 0;
  const users: SasUser[] = (j.data ?? []).map(normalize);
  return { users, total, lastPage: j.last_page ?? Math.max(1, Math.ceil(total / count)) };
}

// عدد المتصلين الآن (الجلسات النشطة) — لعدّاد الشاشة الرئيسية.
// مسار SAS4 لقائمة المتصلين على نمط index/*: نجرّب الاسمين المعروفين ونتذكّر الناجح لكل خادم.
const onlineRouteCache = new Map<string, string>();
export async function sasFetchOnlineCount(base: string, token: string): Promise<number | null> {
  const candidates = onlineRouteCache.has(base)
    ? [onlineRouteCache.get(base)!]
    : ["index/online", "index/online_user"];
  for (const route of candidates) {
    try {
      const raw = await sasPost(base, route, { page: 1, count: 1 }, token);
      const j = JSON.parse(raw.text);
      if (typeof j?.total === "number") {
        onlineRouteCache.set(base, route);
        return j.total;
      }
    } catch { /* جرّب المسار التالي */ }
  }
  return null;
}

// عدّا «الأكتف» و«الكلّي» بنداءين رخيصين على `index/user` (يُعيد `total`) بدل جلبِ كلّ
// المستخدمين: `status:1` يفلتر على الأكتف (مُثبَتٌ على SAS Radius v4)، و`sub_users` يشمل
// الحسابات الفرعية. (status: 1=أكتف · 2=منتهٍ · 3=مستنفَد · 4=معطَّل.)
// ⚠️ **يرمي عند الفشل** (بعد إعادة محاولةٍ) لا يُعيد صفراً: صفرٌ كاذبٌ كان يُسمّم مخزنَ
// الإحصاء والسحابةَ (يدهس أرقاماً صالحةً)، بينما الرميُ يُبقي حارسُ المتّصلِ آخرَ رقمٍ صالح.
export async function sasFetchActiveTotal(base: string, token: string): Promise<{ active: number; total: number }> {
  const count = async (extra: Record<string, unknown>): Promise<number> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await sasPost(base, "index/user", { page: 1, count: 1, sub_users: true, connection: -1, profile_id: -1, parent_id: -1, ...extra }, token);
        const t = JSON.parse(r.text)?.total;
        if (typeof t !== "number") throw new Error("SAS4 index/user: لا يوجد total");
        return t;
      } catch (e) { lastErr = e; await sleep(1000 * (attempt + 1)); }
    }
    throw lastErr;
  };
  const total = await count({});
  const active = await count({ status: 1 });
  return { active, total };
}

// ===== قائمة يوزرات المتّصلين الآن (لفلتر «المتصلين» في صفحة المشتركين — طلب محمد 2026-08-09) =====
// تُصفَّح قائمة index/online كاملةً مرّةً واحدة، ونجمع كلّ القيم النصّيّة من كلّ صفٍّ في مجموعةٍ
// صغيرة الحروف — لأنّ شكل صفّ المتّصلين يختلف بين خوادم الساس (username تحت مفاتيح مختلفة).
// العضويّة في المجموعة = متّصل. تعيد null عند التعذّر (فلا نجزم بعدم اتّصال أحد خطأً).
export async function sasFetchOnlineUsernames(base: string, token: string): Promise<Set<string> | null> {
  const candidates = onlineRouteCache.has(base) ? [onlineRouteCache.get(base)!] : ["index/online", "index/online_user"];
  for (const route of candidates) {
    try {
      const out = new Set<string>();
      let page = 1;
      let total = Infinity;
      let seen = 0;
      while (seen < total && page <= 20) { // سقف 20 صفحة × 500 = 10 آلاف متّصل
        const raw = await sasPost(base, route, { page, count: 500 }, token);
        const j = JSON.parse(raw.text);
        if (typeof j?.total !== "number") break;
        onlineRouteCache.set(base, route);
        total = j.total;
        const rows = (j.data ?? []) as Record<string, unknown>[];
        if (!rows.length) break;
        seen += rows.length;
        for (const r of rows) {
          for (const v of Object.values(r)) {
            if (typeof v === "string" && v.trim()) out.add(v.trim().toLowerCase());
          }
        }
        page++;
      }
      if (seen > 0 || total === 0) return out;
    } catch { /* جرّب المسار التالي */ }
  }
  return null;
}

// حالة اتصال مستخدمٍ واحد الآن (متّصل/غير متّصل): نبحث عن يوزره في قائمة المتّصلين
// (index/online + search). ظهوره حرفيّاً = متّصل. يعيد true/false، أو null عند التعذّر
// (خطأ/جلسة منتهية) أو حين لا يُطبّق الخادم البحث (فلا نجزم بعدم الاتصال خطأً).
export async function sasFetchUserOnline(base: string, token: string, username: string): Promise<boolean | null> {
  const q = username.trim();
  if (!q) return null;
  const candidates = onlineRouteCache.has(base)
    ? [onlineRouteCache.get(base)!]
    : ["index/online", "index/online_user"];
  for (const route of candidates) {
    try {
      const raw = await sasPost(base, route, { page: 1, count: 50, search: q }, token);
      const j = JSON.parse(raw.text);
      if (typeof j?.total === "number") {
        onlineRouteCache.set(base, route);
        const rows = (j.data ?? []) as Record<string, unknown>[];
        // متّصل إن ظهر يوزره حرفيّاً في أيّ حقلٍ من صفوف المتّصلين (شكل الصف يختلف بين الخوادم)
        const found = rows.some((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase() === q.toLowerCase()));
        if (found) return true;
        // إن بقيت نتائج لم نرها (total أكبر من الصفحة ⇒ البحث غالباً غير مُطبَّق) فلا نجزم بعدم الاتصال
        if (j.total > rows.length) return null;
        return false; // رأينا كلّ النتائج ولا تطابق تامّ ⇒ غير متّصل
      }
    } catch { /* جرّب المسار التالي */ }
  }
  return null;
}

// إيجاد مشترك واحد بيوزره عبر بحث قائمة SAS (index/user + search) — يعيد بياناته
// الكاملة كما تعرضها اللوحة (الاسم/الهاتف/الباقة/الانتهاء/الحالة). للاستبدال (2026-07-30):
// محمد يحدّث معلومات الساكن الجديد في SAS أولاً ثم يسحبها الموقع تلقائياً بلا ملء يدوي.
export async function sasFindUserByUsername(base: string, token: string, username: string): Promise<SasUser | null> {
  const q = username.trim();
  if (!q) return null;
  const j = await fetchAnyPage(base, token, "index/user", 1, 50, { search: q });
  const users: SasUser[] = (j.data ?? []).map((u: Record<string, unknown>) => normalize(u));
  return users.find((u) => u.username.toLowerCase() === q.toLowerCase()) ?? null;
}

// جلب مشترك واحد بمعرّفه في SAS4 (GET user/{id}) — يُرجِع تاريخ الانتهاء الفعلي ورصيد القرض
export async function sasFetchUser(
  base: string,
  token: string,
  sasId: number,
): Promise<{ expiration: string | null; loanBalance: number; debtDays: number; username: string | null } | null> {
  try {
    const res = await undiciFetch(base + "user/" + sasId, {
      method: "GET",
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      dispatcher: insecureAgent,
    });
    if (!res.ok) return null;
    const j = JSON.parse(await res.text());
    const u = (j.data ?? j) as Record<string, unknown>;
    if (!u || u.expiration === undefined) return null;
    return {
      expiration: (u.expiration as string) || null,
      loanBalance: Number(u.loan_balance ?? 0),
      debtDays: Number(u.debt_days ?? 0),
      // 🛡️ يوزرُ صاحبِ هذا الرقم في الساس — عمودُ حارسِ «اليوزر المختلف» (حالة bg-7-4-2
      // 2026-08-21: sasId معكوسٌ يفتح صفحةَ يوزرٍ آخرَ والمالُ كاد يذهب لحسابه)
      username: typeof u.username === "string" && u.username.trim() ? u.username : null,
    };
  } catch {
    return null;
  }
}

// باسورد اليوزر من ملفّ الـOverview (GET user/overview/{id}) — يُرجِعه الساس صراحةً في حقل password
export async function sasFetchUserPassword(base: string, token: string, sasId: number): Promise<string | null> {
  try {
    const res = await undiciFetch(base + "user/overview/" + sasId, {
      method: "GET",
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      dispatcher: insecureAgent,
    });
    if (!res.ok) return null;
    const j = JSON.parse(await res.text());
    const u = (j.data ?? j) as Record<string, unknown>;
    const pw = u?.password;
    if (pw == null) return null;
    const s = String(pw).trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

// صف من تقرير التفعيلات (index/activations)
export interface SasActivation {
  sasUserId: number;
  username: string | null;
  name: string | null;
  pin: string | null; // الكارت المستخدم (voucher) أو رمز العملية
  method: string | null; // voucher | user_credit | ...
  oldExpiration: string | null;
  newExpiration: string | null;
  managerUsername: string | null;
  createdAt: string | null;
  price: number;
}

function normalizeActivation(a: Record<string, unknown>): SasActivation {
  const u = a.user_details as { id?: number; username?: string; firstname?: string; lastname?: string } | undefined;
  const m = a.manager_details as { username?: string } | undefined;
  // دمج الاسم الأول والثاني في اسم واحد (نفس سلوك استيراد المشتركين)
  const actName = [(u?.firstname ?? "").trim(), (u?.lastname ?? "").trim()].filter(Boolean).join(" ") || null;
  return {
    sasUserId: Number(a.user_id),
    username: u?.username ?? null,
    name: actName,
    pin: (a.pin as string) ?? null,
    method: (a.activation_method as string) ?? null,
    oldExpiration: (a.old_expiration as string) ?? null,
    newExpiration: (a.new_expiration as string) ?? null,
    managerUsername: m?.username ?? null,
    createdAt: (a.created_at as string) ?? null,
    price: Number(a.price ?? 0),
  };
}

/** 🔬 نداءٌ خامٌ للتشخيص وحدَه: يُظهر ما يعيده الساسُ لصيغةِ طلبٍ بعينها.
 *  (سببُ وجوده: تفعيلاتُ الكابينات لا تصل المزامنةَ بينما تراها لوحةُ الساس —
 *   والفرقُ في **بارامترات الطلب**، فتُجرَّب صيغُها بالقياس لا بالظنّ.) */
export async function sasRawPost(base: string, token: string, route: string, payload: unknown): Promise<unknown> {
  const r = await sasPost(base, route, payload, token);
  try { return JSON.parse(r.text); } catch { return { status: r.status, raw: r.text.slice(0, 200) }; }
}
// مساعد عام لجلب صفحة من أي مسار مُرقَّم (index/*) مع إعادة محاولة.
// extra: بارامترات إضافية تُدمج في الجسم (مثل search للبحث بالبِن).
async function fetchAnyPage(
  base: string, token: string, route: string, page: number, count: number,
  extra?: Record<string, unknown>,
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await sasPost(base, route, { page, count, ...(extra ?? {}) }, token);
      return JSON.parse(raw.text);
    } catch (e) { lastErr = e; await sleep(1200 * (attempt + 1)); }
  }
  throw lastErr;
}

// تحقّق مباشر: هل رقم كارت (السيريال = pin) مُفعّل في تقرير SAS بصرف النظر عن تاريخ تفعيله؟
// يستخدم بحث SAS بالبِن (search) الذي يجد التفعيل ولو وقع خارج نافذة المزامنة (يُفعَّل الكارت
// في يومٍ ويُعلَّم مستخدماً في البرنامج في يومٍ آخر — نمط مكاتب الريسيلر الكبيرة). يُعيد صف
// التفعيل عند الوجود وإلا null. لا يرمي استثناءً كي لا يُسقِط المزامنة عند تعثّر استعلام واحد.
// ═════ 🔎 مسبارُ السيريال — نتيجةٌ صريحةٌ تُفرّق «غيرُ موجود» عن «تعذّر الفحص» ═════
// (تدقيقُ محمد 2026-08-21: «هل بحثُ الكروت واحداً تلو الآخر موثوق؟») — ثلاثةُ عيوبٍ
// كانت في الصيغة القديمة، وكلُّها تُنتج **«لم يُوجد» كاذباً**:
//   ١· صفحةٌ واحدةٌ بعشرين صفّاً فقط: بحثُ الساس يطابق أيَّ حقلٍ (اسم/يوزر/رقم)، فصفُّ
//      السيريال المطلوب قد يقع خارج العشرين الأولى فلا يُرى أصلاً.
//   ٢· مطابقةٌ حرفيّةٌ صارمة: فارقُ مسافةٍ أو شرطةٍ أو رقمٍ يعود عدداً (فتسقط الأصفارُ
//      البادئة) يكفي لإسقاط التطابق.
//   ٣· `catch` يبتلع عطلَ الشبكة فيبدو كأنّ الكارتَ غيرُ مستخدَم — وهذا أخطرُها، لأنّ
//      الدفترَ كان سيختمه «غير مستخدَم» ويمتنع عن إعادة فحصه أسبوعاً كاملاً.
const pinKey = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
const digitsOnly = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
const samePin = (a: unknown, b: unknown): boolean => {
  const ka = pinKey(a), kb = pinKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const da = digitsOnly(a), db = digitsOnly(b);
  return !!da && da === db; // أصفارٌ بادئةٌ سقطت أو صيغةٌ مختلفة
};

export type SerialProbe = { ok: boolean; hit: SasActivation | null };

/** يبحث عن تفعيلةِ سيريالٍ في شجرة الحساب كاملةً (search يغطّي الحساباتِ الفرعيّة).
 *  `ok:false` تعني **تعذّر الفحصُ** لا «غيرُ موجود» — فلا يُبنى عليها حكمٌ سلبيّ أبداً. */
export async function sasProbeSerial(base: string, token: string, serial: string): Promise<SerialProbe> {
  const s = (serial ?? "").trim();
  if (!s) return { ok: true, hit: null };
  const PAGE = 100, MAX_PAGES = 3; // حتى ٣٠٠ صفّاً من نتائج البحث — أوسع بخمس عشرة مرّةً من القديم
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const j = await fetchAnyPage(base, token, "index/activations", page, PAGE, { search: s });
      const rows: Record<string, unknown>[] = j?.data ?? [];
      if (!rows.length) break;
      const hit = rows.find((r) => samePin((r as { pin?: unknown }).pin, s));
      if (hit) return { ok: true, hit: normalizeActivation(hit) };
      const total = Number(j?.total ?? 0);
      if (rows.length < PAGE || (total && page * PAGE >= total)) break;
    }
    return { ok: true, hit: null };
  } catch {
    return { ok: false, hit: null }; // عطلُ شبكةٍ/جلسة — لا يُقرأ «غيرَ مستخدَم»
  }
}

// ═════ 🎯 مسبارُ تفعيلاتِ يوزرٍ بعينه (بلاغ محمد 2026-08-21: bg-53-10-3@shu) ═════
// المزامنةُ تجلب تفعيلاتِ يومَين فقط (الأمس واليوم) — فمن فُعِّل قبلَهما يظهر عندنا
// **فرقَ تاريخٍ مجرّداً** في تبويب «تحديث معلومات»، ولا يُعرف أفعّله هو بنفسه أم الشركة
// أم البرنامج. وبحثُ الساس (search) يطابق اليوزرَ أيضاً — فسؤالٌ موجَّهٌ واحدٌ لكلّ حالةٍ
// **مشكوكٍ فيها** يكشف المنجرَ والتاريخَ والمبلغَ، فيُصنَّف الصفُّ في تبويبه الصحيح.
// `ok:false` تعني تعذّر الفحصَ — فيبقى الصفُّ فرقَ تاريخٍ كما كان (لا حكمَ على شكّ).
export type UserActProbe = { ok: boolean; rows: SasActivation[] };
export async function sasProbeUserActivations(
  base: string, token: string, username: string, sasUserId?: number,
): Promise<UserActProbe> {
  const q = (username ?? "").trim();
  if (!q) return { ok: true, rows: [] };
  const uk = q.toLowerCase();
  try {
    const j = await fetchAnyPage(base, token, "index/activations", 1, 100, { search: q });
    const raw: Record<string, unknown>[] = j?.data ?? [];
    const rows = raw.map(normalizeActivation).filter((a) =>
      (a.username ?? "").trim().toLowerCase() === uk || (sasUserId != null && a.sasUserId === sasUserId));
    rows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}
/** 🎴 بحثُ سيريالِ كارتٍ **من النافذة المفهرَسة** — لا يعتمد على `search` المعطَّل.
 *  `ok:false` ⇒ النافذةُ ناقصةٌ (عطلُ شبكةٍ أو الكارتُ أقدمُ من النافذة) ⇒ **لا يُحكَم**
 *  بأنّه غيرُ مستخدَم. وهذه هي القاعدةُ التي حمت الدفترَ من ختمٍ كاذبٍ أسبوعاً كاملاً. */
export async function sasFindSerial(base: string, token: string, serial: string, days = 35): Promise<SerialProbe> {
  const s = (serial ?? "").trim();
  if (!s) return { ok: true, hit: null };
  const win = await sasActivationWindow(base, token, days);
  return actWindowFindSerial(win, s);
}

// ═════ 🎯 تفعيلاتُ يوزرٍ بعينه — بالبحث المباشر (القياسُ الفاصل 2026-08-21) ═════
// ثبت بالقياس على مخدّم سوبر سيل أنّ تقرير التفعيلات **مُجمَّعٌ بالمنجر لا مرتَّبٌ
// بالتاريخ**: الصفحةُ الأولى (٥٠٠ صفّ) كلُّها `FDT47-SHU` من ٢٠٢٥-٠١ إلى ٢٠٢٥-٠٥.
// ⇒ أيُّ مسحٍ يعتمد ترتيبَ التاريخ يقع داخل كتلةِ منجرٍ واحدٍ ويظنّ أنّه انتهى، فتغيب
//   عنه تفعيلاتُ الكابينات كلُّها (وهي «التفعيلاتُ الخارجيّة» بعينها) — وهذا كان سببَ
//   بقاء تفعيلاتِ الشهداء الذاتيّة في تبويب «تحديث معلومات» ووسمِ كروتٍ حيّةٍ بالوهميّة.
// 🔑 و`search` **يعمل** (٣ صيغِ ترشيحٍ أخرى فشلت وهذه نجحت): سؤالٌ واحدٌ باليوزر يُعيد
//    تاريخَه كاملاً بمنجراته وأسعاره وبِناته — فالتصنيفُ يصير على أرضٍ صلبة.
export type UserActs = { ok: boolean; rows: SasActivation[] };
export async function sasUserActivations(base: string, token: string, username: string): Promise<UserActs> {
  const q = (username ?? "").trim();
  if (!q) return { ok: true, rows: [] };
  const uk = q.toLowerCase();
  try {
    const j = await fetchAnyPage(base, token, "index/activations", 1, 200, { search: q });
    const raw: Record<string, unknown>[] = j?.data ?? [];
    const rows = raw.map(normalizeActivation)
      .filter((a) => (a.username ?? "").trim().toLowerCase() === uk)
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] }; // عطلُ شبكةٍ — لا يُبنى عليه نفيٌ أبداً
  }
}
export async function sasSearchActivation(
  base: string, token: string, serial: string,
): Promise<SasActivation | null> {
  return (await sasProbeSerial(base, token, serial)).hit;
}

// ═════ 🗓️ الجالبُ المرتَّبُ بالتاريخ — أساسُ «الطبقة الثانية» (طلبُ محمد 2026-08-22) ═════
//
// 🔴 **العلّةُ التي يُصلحها** (قِيست على الإنتاج 2026-08-21): تقريرُ التفعيلات يعود
//   افتراضيّاً **مُجمَّعاً بالمنجر** لا مرتَّباً بالتاريخ — أوّلُ ٥٠٠ صفٍّ في الرسالة كلُّها
//   `FDT34-RES` من 2025-01-14 إلى 2025-06-23، وفي الشهداء كلُّها `FDT47-SHU` من 2025-01-13.
//   فالمسحُ الزمنيُّ يقف داخل كتلةِ منجرٍ ويظنّ أنّه أتمّ ⇒ **صورةٌ ناقصةٌ بصمت**: نافذةُ
//   ٥ أيّامٍ أعادت ٩٨ صفّاً في الرسالة و٢٥٢ في الشهداء وقالت «كاملة»، وفيها **صفرُ** صفوفٍ
//   لأربعة مشتركين ثبت بالبحث أنّهم فُعِّلوا داخلها.
//
// ✅ **والحلُّ الذي اقترحه محمد وقِيس فنجح**: التقريرُ يقبل الترتيبَ بالتاريخ — من عشر
//   صيغٍ جُرّبت نجحت `sortBy: "created_at"` وحدَها. وبها:
//     • الشهداء: صفحةٌ واحدةٌ (٥٠٠) تغطّي 21/08 22:41 ← 15/08 18:05 = **٦ أيّام**
//     • الرسالة: صفحةٌ واحدةٌ تغطّي 21/08 21:56 ← 05/08 22:17 = **١٦ يوماً**
//     • والصفحةُ الثانيةُ تُكمل بلا ثقب (15/08 18:04 مباشرةً بعد 18:05)
//   ⇒ نافذةُ يومين لا تحتاج إلّا جزءاً من صفحة، ولا تعتمد على العدد الكلّيّ (٣٧ ألفاً في
//     الشهداء) ولا على تجميع المنجر — **فلا تنكسر بعد سنةٍ ولا بعد عشر**.
//
// 🛡️ **وحارسُ الصدق**: إن تجاهل المخدّمُ الترتيبَ يوماً (تحديثُ نسخةٍ مثلاً) تُكشَف
//   الحالةُ من الصفحة الأولى (ليست تنازليّة) ⇒ **يسقط النداءُ إلى المسح القديم** ويُعلَن
//   `sorted: false`. فلا يُبنى حكمٌ على نافذةٍ يُظنّ أنّها كاملةٌ وهي ليست كذلك.
const SORT_BODY = { sortBy: "created_at", sortDir: "desc" } as const;

/** ⏱️ حدُّ مقارنةٍ بتوقيت الساس: أرقامُ `created_at` ساعةُ بغداد وتُقرأ UTC ⇒ يُزاح الحدُّ ٣ ساعات.
 *  (بلا هذا كانت نافذةُ «اليوم» تقف عند ٢١:٠٠ بغداد فتسقط تفعيلاتُ الليل — قِيس 2026-08-21.) */
export function sasWindowBound(d: Date): Date {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000);
}

/** صفوفُ الصفحة تنازليّةٌ بالتاريخ؟ (حارسُ الصدق — لا يُبنى حكمٌ على ترتيبٍ لم يُطبَّق) */
function isDescending(rows: Record<string, unknown>[]): boolean {
  let prev = Infinity;
  let seen = 0;
  for (const r of rows) {
    const c = r.created_at ? new Date(r.created_at as string).getTime() : NaN;
    if (isNaN(c)) continue;
    if (c > prev) return false;
    prev = c; seen++;
  }
  return seen > 0;
}

/**
 * جلبُ التفعيلات **مرتَّبةً من الأحدث** حتى بلوغ `since` (أو نفاد الصفحات).
 * يُعيد `sorted: false` إن لم يُطبِّق المخدّمُ الترتيب — فيتولّى المتّصلُ السقوطَ للقديم.
 */
async function fetchSortedActivations(
  base: string, token: string, since: Date,
  opts: { count?: number; gapMs?: number; maxPages?: number; onPage?: (fetched: number, total: number) => Promise<boolean> | boolean } = {},
): Promise<{ rows: SasActivation[]; complete: boolean; sorted: boolean }> {
  const COUNT = opts.count ?? 500;
  const GAP_MS = opts.gapMs ?? 1200;
  const MAX_PAGES = opts.maxPages ?? 60;
  const bound = sasWindowBound(since).getTime();

  const first = await fetchAnyPage(base, token, "index/activations", 1, COUNT, SORT_BODY);
  const firstData: Record<string, unknown>[] = first.data ?? [];
  const total: number = first.total ?? firstData.length;
  if (!firstData.length) return { rows: [], complete: true, sorted: true };
  if (!isDescending(firstData)) return { rows: [], complete: false, sorted: false };

  const rows: SasActivation[] = [];
  let reachedOlder = false;
  const collect = (data: Record<string, unknown>[]) => {
    for (const r of data) {
      const c = r.created_at ? new Date(r.created_at as string).getTime() : NaN;
      if (isNaN(c)) continue;
      if (c < bound) { reachedOlder = true; continue; }
      rows.push(normalizeActivation(r));
    }
  };

  let pages = 0;
  const lastPage = Math.max(1, Math.ceil(total / COUNT));
  const pageDone = async (): Promise<boolean> => {
    pages++;
    if (!opts.onPage) return true;
    return (await opts.onPage(Math.min(pages * COUNT, total), total)) !== false;
  };

  collect(firstData);
  if (!(await pageDone())) return { rows, complete: false, sorted: true };
  for (let page = 2; page <= lastPage && pages < MAX_PAGES && !reachedOlder; page++) {
    await sleep(GAP_MS);
    const d: Record<string, unknown>[] = (await fetchAnyPage(base, token, "index/activations", page, COUNT, SORT_BODY)).data ?? [];
    if (!d.length) break;
    if (!isDescending(d)) return { rows: [], complete: false, sorted: false }; // انقلب الترتيبُ في منتصف الطريق
    collect(d);
    if (!(await pageDone())) return { rows, complete: false, sorted: true };
  }
  // كاملةٌ إن بلغنا ما هو أقدمُ من النافذة، أو استنفدنا صفحاتِ التقرير كلَّها
  return { rows, complete: reachedOlder || pages >= lastPage, sorted: true };
}

export async function sasFetchActivationsForDay(
  base: string,
  token: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<SasActivation[]> {
  // 🗓️ الطريقُ الأوّل: مرتَّبٌ بالتاريخ (سطرٌ واحدٌ يكفي نافذةَ يومين). وعند تعذّره ⇒ القديم.
  try {
    const s = await fetchSortedActivations(base, token, dayStart);
    if (s.sorted) {
      const lo = sasWindowBound(dayStart).getTime();
      const hi = sasWindowBound(dayEnd).getTime();
      return s.rows.filter((a) => {
        const c = a.createdAt ? new Date(a.createdAt).getTime() : NaN;
        return !isNaN(c) && c >= lo && c <= hi;
      });
    }
  } catch { /* تعذّر الترتيبُ ⇒ الطريقُ القديم */ }
  return legacyFetchActivationsForDay(base, token, dayStart, dayEnd);
}

// 🕰️ **المسارُ القديم — احتياطيٌّ لا أصليّ**: يكتشف اتجاهَ ترتيب الساس ويمسح من الطرف
// الأحدث. وعلّتُه معروفةٌ ومقيسة (التقريرُ مُجمَّعٌ بالمنجر فيقف المسحُ داخل كتلة)، فلا
// يُستعمل إلّا حين يتعذّر الترتيبُ بالتاريخ — وحينها تبقى صورةٌ ناقصةٌ خيراً من لا شيء.
async function legacyFetchActivationsForDay(
  base: string,
  token: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<SasActivation[]> {
  const COUNT = 500; // 500 لكل صفحة لتقليل عدد الطلبات على SAS
  const GAP_MS = 2000; // تأخير بين طلب وآخر لتفادي الحظر
  const MAX_PAGES = 40; // حماية أوسع (كان 15) — يكفي 20 ألف تفعيل حديث

  const meta = await fetchAnyPage(base, token, "index/activations", 1, 1);
  const total: number = meta.total ?? 0;
  if (!total) return [];
  const lastPage = Math.max(1, Math.ceil(total / COUNT));

  // ⏱️ الحدودُ تُزاح ٣ ساعاتٍ لتطابق أرقامَ الساس (شرحُها عند `sasWindowBound`)
  const lo = sasWindowBound(dayStart);
  const hi = sasWindowBound(dayEnd);
  const rows: SasActivation[] = [];
  // يجمع صفوف النطاق من صفحة، ويُبلّغ هل ظهرت صفوف أقدم من بداية اليوم (إشارة توقّف)
  const collect = (data: Record<string, unknown>[]): boolean => {
    let sawOlder = false;
    for (const r of data) {
      const c = r.created_at ? new Date(r.created_at as string) : null;
      if (!c || isNaN(c.getTime())) continue;
      if (c >= lo && c <= hi) rows.push(normalizeActivation(r));
      if (c < lo) sawOlder = true;
    }
    return sawOlder;
  };

  // اكتشاف الاتجاه من الصفحة الأولى: إن حوت تفعيلاً ضمن/بعد بداية اليوم ⇒ تنازلي (الأحدث أولاً)
  const first = await fetchAnyPage(base, token, "index/activations", 1, COUNT);
  const firstData: Record<string, unknown>[] = first.data ?? [];
  const descending = firstData.some((r) => {
    const c = r.created_at ? new Date(r.created_at as string) : null;
    return c && !isNaN(c.getTime()) && c >= lo;
  });

  if (descending || lastPage === 1) {
    // الأحدث في الصفحة 1 ⇒ نتقدّم للأمام حتى نتجاوز بداية اليوم
    if (!collect(firstData)) {
      for (let page = 2, n = 0; page <= lastPage && n < MAX_PAGES; page++, n++) {
        await sleep(GAP_MS);
        const d: Record<string, unknown>[] = (await fetchAnyPage(base, token, "index/activations", page, COUNT)).data ?? [];
        if (d.length === 0 || collect(d)) break;
      }
    }
  } else {
    // تصاعدي: الأحدث في الصفحة الأخيرة ⇒ نتراجع للخلف حتى نتجاوز بداية اليوم
    for (let page = lastPage, n = 0; page >= 1 && n < MAX_PAGES; page--, n++) {
      if (n > 0) await sleep(GAP_MS);
      const d: Record<string, unknown>[] = page === 1 ? firstData : ((await fetchAnyPage(base, token, "index/activations", page, COUNT)).data ?? []);
      if (d.length === 0 || collect(d)) break;
    }
  }
  return rows;
}

// ═════ ⚠️🪟 نافذةُ التفعيلات الزمنيّة — **للتشخيص وحدَه، لا يُبنى عليها حكم** ═════
// (كُتبت يوم ظننتُ أنّ `search` معطَّل، ثمّ ثبت عكسُه.) وثبت أيضاً أنّ تقرير التفعيلات
// **مُجمَّعٌ بالمنجر لا مرتَّبٌ بالتاريخ**: أوّلُ ٥٠٠ صفٍّ كلُّها منجرٌ واحدٌ من ٢٠٢٥-٠١
// إلى ٢٠٢٥-٠٥. ⇒ أيُّ مسحٍ زمنيٍّ يتوقّف داخل كتلةِ منجرٍ ويُعيد صورةً **ناقصةً بصمت**
// (قِيس: نافذةُ يومَين أعادت ٧٩ صفّاً كلُّها بمنجر حساب المكتب، وأحدثُها أقدمُ من
//  تفعيلٍ حقيقيٍّ رأيناه في اللوحة). لا تستعملها المزامنةُ إطلاقاً — البديلُ `search`.
// اختُبر مخدّمُ الساس باثنتَي عشرة صيغةِ ترشيح (search نصّاً وكائناً · filter · filters ·
// where · user_id · username · keyword): **كلُّها تُتجاهَل** ويعود أقدمُ عشرة صفوفٍ من
// سبعةٍ وثلاثين ألفاً. فكلُّ ما بُني على `search` كان يمسح تفعيلاتِ ٢٠٢٥ ثمّ يقول «غير
// موجود»: مسبارُ السيريال · حارسُ حذف الكارت · دفترُ الفحص · تصنيفُ قفزة التاريخ.
// 🔑 والترقيمُ (page/count) **يعمل** — مُثبَتٌ على الإنتاج. فالبديلُ الصحيح: جلبُ نافذةٍ
//    زمنيّةٍ واحدةٍ بالترقيم مرّةً، وفهرستُها في الذاكرة بثلاثة مفاتيح (الرقم · اليوزر ·
//    البِن)، فتُجاب كلُّ الأسئلة منها بصفر نداءاتٍ إضافيّة.
// ⏱️ وذاكرةٌ مؤقّتة ١٠ دقائق مفتاحُها **التوكن** لا الرابط — فحسابان على مخدّمٍ واحدٍ
//    لا يريان نافذةَ بعضهما أبداً (عزلُ الوكيل شرطٌ دائم).
export type ActWindow = {
  since: Date;
  complete: boolean;          // false = النافذةُ ناقصةٌ (تعذّر مسحُها كاملةً) ⇒ لا حكمَ سلبيّاً
  rows: SasActivation[];
  byUser: Map<string, SasActivation[]>;   // يوزرٌ (حروفٌ صغيرة) ⇒ تفعيلاتُه (الأحدثُ أوّلاً)
  bySasId: Map<number, SasActivation[]>;
  byPin: Map<string, SasActivation>;      // سيريالُ الكارت (مطبَّعاً) ⇒ تفعيلتُه
};

const actWinCache = new Map<string, { at: number; win: ActWindow }>();
const ACT_WIN_TTL_MS = 10 * 60_000;

export async function sasActivationWindow(
  base: string, token: string, days = 35,
): Promise<ActWindow> {
  const key = `${base}|${String(token).slice(-24)}|${days}`;
  const hit = actWinCache.get(key);
  if (hit && Date.now() - hit.at < ACT_WIN_TTL_MS) return hit.win;
  const since = new Date(Date.now() - days * 86400_000);
  let rows: SasActivation[] = [], complete = false;
  try {
    const r = await sasFetchActivationsSince(base, token, since);
    rows = r.rows; complete = r.complete;
  } catch {
    rows = []; complete = false; // عطلُ شبكةٍ ⇒ نافذةٌ فارغةٌ **غيرُ مكتملة**، لا تُبنى عليها نفي
  }
  rows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const byUser = new Map<string, SasActivation[]>();
  const bySasId = new Map<number, SasActivation[]>();
  const byPin = new Map<string, SasActivation>();
  for (const a of rows) {
    const u = (a.username ?? "").trim().toLowerCase();
    if (u) { const l = byUser.get(u) ?? []; l.push(a); byUser.set(u, l); }
    const l2 = bySasId.get(a.sasUserId) ?? []; l2.push(a); bySasId.set(a.sasUserId, l2);
    const pk = pinKey(a.pin);
    if (pk && !byPin.has(pk)) byPin.set(pk, a);
    const dk = digitsOnly(a.pin);
    if (dk && dk !== pk && !byPin.has(dk)) byPin.set(dk, a);
  }
  const win: ActWindow = { since, complete, rows, byUser, bySasId, byPin };
  actWinCache.set(key, { at: Date.now(), win });
  return win;
}

/** تفعيلةُ سيريالٍ من النافذة المفهرَسة. `ok:false` = النافذةُ ناقصةٌ ⇒ **لا يُحكَم** بعدمه. */
export function actWindowFindSerial(win: ActWindow, serial: string): SerialProbe {
  const s = (serial ?? "").trim();
  if (!s) return { ok: true, hit: null };
  const hit = win.byPin.get(pinKey(s)) ?? win.byPin.get(digitsOnly(s)) ?? null;
  if (hit) return { ok: true, hit };
  return { ok: win.complete, hit: null };
}
// جلب كل تفعيلات SAS منذ تاريخ محدّد — صفحة واحدة كل 500 صفّ بدل استعلام لكل كارت.
// الفحص الشامل كان يبحث سيريال كل كارت على حدة (423 استعلاماً × ~5 ثوانٍ ≈ 45 دقيقة)؛
// هذه الدالّة تجلب الكل في ~10 طلبات فتنتهي المطابقة في أقل من دقيقة.
// onPage: يُستدعى بعد كل صفحة لتحديث مؤشّر التقدّم؛ يُرجع false لإلغاء الجلب.
export async function sasFetchActivationsSince(
  base: string,
  token: string,
  since: Date,
  onPage?: (fetched: number, total: number) => Promise<boolean> | boolean,
): Promise<{ rows: SasActivation[]; complete: boolean }> {
  // 🗓️ المرتَّبُ أوّلاً (١٢٠ يوماً ≈ ٢٠ صفحةً في الشهداء)، وعند تعذّره ⇒ المسحُ القديم
  try {
    const s = await fetchSortedActivations(base, token, since, { onPage });
    if (s.sorted) return { rows: s.rows, complete: s.complete };
  } catch { /* تعذّر الترتيبُ ⇒ الطريقُ القديم */ }
  return legacyFetchActivationsSince(base, token, since, onPage);
}

async function legacyFetchActivationsSince(
  base: string,
  token: string,
  since: Date,
  onPage?: (fetched: number, total: number) => Promise<boolean> | boolean,
): Promise<{ rows: SasActivation[]; complete: boolean }> {
  const COUNT = 500;
  const GAP_MS = 1200;
  const MAX_PAGES = 60; // حتى 30 ألف تفعيل — أوسع من أي نافذة نستعملها

  const meta = await fetchAnyPage(base, token, "index/activations", 1, 1);
  const total: number = meta.total ?? 0;
  if (!total) return { rows: [], complete: true };
  const lastPage = Math.max(1, Math.ceil(total / COUNT));

  // ⏱️ الحدُّ مُزاحٌ ٣ ساعاتٍ ليطابق أرقامَ الساس (شرحُها عند `sasWindowBound`)
  const lo = sasWindowBound(since);
  const rows: SasActivation[] = [];
  let reachedOlder = false; // بلغنا صفوفاً أقدم من النافذة ⇒ لا حاجة للمتابعة
  const collect = (data: Record<string, unknown>[]) => {
    for (const r of data) {
      const c = r.created_at ? new Date(r.created_at as string) : null;
      if (c && !isNaN(c.getTime()) && c < lo) { reachedOlder = true; continue; }
      rows.push(normalizeActivation(r));
    }
  };

  // اتجاه الترتيب: إن حوت الصفحة الأولى صفوفاً داخل النافذة ⇒ تنازلي (الأحدث أولاً)
  const first = await fetchAnyPage(base, token, "index/activations", 1, COUNT);
  const firstData: Record<string, unknown>[] = first.data ?? [];
  const descending = firstData.some((r) => {
    const c = r.created_at ? new Date(r.created_at as string) : null;
    return c && !isNaN(c.getTime()) && c >= lo;
  });

  let pages = 0;
  const pageDone = async (): Promise<boolean> => {
    pages++;
    if (!onPage) return true;
    return (await onPage(Math.min(pages * COUNT, total), total)) !== false;
  };

  if (descending || lastPage === 1) {
    collect(firstData);
    if (!(await pageDone())) return { rows, complete: false };
    for (let page = 2; page <= lastPage && pages < MAX_PAGES && !reachedOlder; page++) {
      await sleep(GAP_MS);
      const d: Record<string, unknown>[] = (await fetchAnyPage(base, token, "index/activations", page, COUNT)).data ?? [];
      if (d.length === 0) break;
      collect(d);
      if (!(await pageDone())) return { rows, complete: false };
    }
  } else {
    // تصاعدي: الأحدث في الصفحة الأخيرة ⇒ نتراجع للخلف حتى نتجاوز بداية النافذة
    for (let page = lastPage; page >= 1 && pages < MAX_PAGES && !reachedOlder; page--) {
      if (pages > 0) await sleep(GAP_MS);
      const d: Record<string, unknown>[] = page === 1 ? firstData : ((await fetchAnyPage(base, token, "index/activations", page, COUNT)).data ?? []);
      if (d.length === 0) break;
      collect(d);
      if (!(await pageDone())) return { rows, complete: false };
    }
  }
  // complete = بلغنا نهاية النافذة فعلاً (لا قطعنا الحلقة بحدّ الصفحات)
  return { rows, complete: reachedOlder || pages < MAX_PAGES };
}

// جلب كل مشتركي المكتب من SAS بصفحات 500 مع تأخير بين الطلبات (المرحلة 2 من المزامنة).
// خفيف على السيرفر ويتجنّب الحظر. maxPages حماية من الحلقات.
export async function sasFetchAllUsers(
  base: string,
  token: string,
  count = 500,
  gapMs = 2000,
  maxPages = 60,
): Promise<SasUser[]> {
  const first = await fetchUserPage(base, token, 1, count);
  const lastPage: number = first.last_page ?? Math.max(1, Math.ceil((first.total ?? 0) / count));
  const users: SasUser[] = (first.data ?? []).map(normalize);
  const end = Math.min(lastPage, maxPages);
  for (let p = 2; p <= end; p++) {
    await sleep(gapMs); // مهلة بين الصفحات لتفادي الحظر
    try {
      const j = await fetchUserPage(base, token, p, count);
      for (const u of j.data ?? []) users.push(normalize(u));
    } catch {
      /* تخطّي صفحة متعثّرة دون إسقاط المزامنة */
    }
  }
  return users;
}

// جلب نطاق صفحات محدّد (سريع وخفيف على السيرفر) — كل صفحة ~10 مشتركين
export async function sasFetchUsersRange(
  base: string,
  token: string,
  fromPage: number,
  toPage: number,
): Promise<{ users: SasUser[]; lastPage: number; total: number }> {
  const first = await fetchUserPage(base, token, Math.max(1, fromPage));
  const lastPage: number = first.last_page ?? 1;
  const total: number = first.total ?? 0;
  const end = Math.min(toPage, lastPage);

  const users: SasUser[] = (first.data ?? []).map(normalize);
  for (let p = fromPage + 1; p <= end; p++) {
    try {
      const j = await fetchUserPage(base, token, p);
      for (const u of j.data ?? []) users.push(normalize(u));
    } catch {
      /* تخطّي صفحة متعثّرة */
    }
    await sleep(150);
  }
  return { users, lastPage, total };
}
