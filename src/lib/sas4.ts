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

// جلب مشترك واحد بمعرّفه في SAS4 (GET user/{id}) — يُرجِع تاريخ الانتهاء الفعلي ورصيد القرض
export async function sasFetchUser(
  base: string,
  token: string,
  sasId: number,
): Promise<{ expiration: string | null; loanBalance: number; debtDays: number } | null> {
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
    };
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

// مساعد عام لجلب صفحة من أي مسار مُرقَّم (index/*) مع إعادة محاولة
async function fetchAnyPage(base: string, token: string, route: string, page: number, count: number) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await sasPost(base, route, { page, count }, token);
      return JSON.parse(raw.text);
    } catch (e) { lastErr = e; await sleep(1200 * (attempt + 1)); }
  }
  throw lastErr;
}

// جلب تفعيلات يوم محدّد من تقرير التفعيلات (index/activations، مرتّب تصاعدياً فنبدأ من آخر صفحة)
export async function sasFetchActivationsForDay(
  base: string,
  token: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<SasActivation[]> {
  const COUNT = 500; // 500 لكل صفحة لتقليل عدد الطلبات على SAS
  const GAP_MS = 2000; // تأخير بين طلب وآخر لتفادي الحظر
  const meta = await fetchAnyPage(base, token, "index/activations", 1, 1);
  const total: number = meta.total ?? 0;
  if (!total) return [];
  let page = Math.max(1, Math.ceil(total / COUNT));

  const rows: SasActivation[] = [];
  for (let guardN = 0; guardN < 15 && page >= 1; guardN++, page--) {
    if (guardN > 0) await sleep(GAP_MS); // مهلة بين الصفحات
    const j = await fetchAnyPage(base, token, "index/activations", page, COUNT);
    const data: Record<string, unknown>[] = j.data ?? [];
    if (data.length === 0) break;
    let oldestOnPage: Date | null = null;
    for (const r of data) {
      const created = r.created_at ? new Date(r.created_at as string) : null;
      if (created && (!oldestOnPage || created < oldestOnPage)) oldestOnPage = created;
      if (created && created >= dayStart && created <= dayEnd) rows.push(normalizeActivation(r));
    }
    if (oldestOnPage && oldestOnPage < dayStart) break; // تجاوزنا بداية اليوم
  }
  return rows;
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
