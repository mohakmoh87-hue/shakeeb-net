import { fetch as undiciFetch, Agent } from "undici";
import { sasBaseUrl, sasLogin } from "@/lib/sas4";

// ===== قروض سوبر سيل (فزعة) — وحدة الاتصال الخادميّة (طلب محمد 2026-08-06) =====
// عمليّة صامتة تماماً: خادمُنا يسجّل الدخول ببيانات المكتب، يقرأ ملفّ المشترك، ثم يمنح
// «فزعة». ثلاث ضمانات أمان تمنع منح القرض لمشتركٍ خطأ:
//   ١) الرقم مخزَّن لا مُخمَّن (subscriber.sasId من المزامنة).
//   ٢) حارس مطابقة: نتحقّق أن يوزر السجلّ العائد = يوزر المشترك المقصود حرفيّاً قبل المنح.
//   ٣) سوبر سيل نفسها ترفض المفعَّل («لا يمكن») ومَن عليه قرض («user has loans»).
//
// مسارات مؤكَّدة من رصد لوحة الـdealer:
//   - سجلّ المشترك:   GET reseller.scn-ftth.com/admin/api/index.php/api/user/{sasId}  (Bearer)
//   - ملفّ + رمز خاصّ: GET notify.supercellnetwork.com/api/manger-api/sas/UserProfile?userId={sasId}  (Bearer + x-sas: ftth)
//   - منح القرض:      POST notify.supercellnetwork.com/api/users/fzaa/activate  (Bearer <الرمز الخاصّ> + x-sas: ftth، بلا جسم)

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const RESELLER_HOST = "reseller.scn-ftth.com";
const RESELLER_AUTH_URL = `https://${RESELLER_HOST}/user/api/index.php/api/auth/login`;
const NOTIFY_BASE = "https://notify.supercellnetwork.com/api/";
const X_SAS = "ftth";

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// ---- تسجيل الدخول → رمز الوكيل (dealer token) ----------------------------------
// نجرّب أوّلاً نقطة auth/login (هي التي أصدرت الرمز الذي تستعمله اللوحة، بحسب iss في الـJWT)
// بجسمٍ JSON عاديّ، فإن تعذّر نرجع إلى تسجيل دخول SAS4 المشفّر (AES) على /admin/api.
async function plainAuthLogin(username: string, password: string): Promise<string> {
  const res = await undiciFetch(RESELLER_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json", "x-sas": X_SAS },
    body: JSON.stringify({ username, password }),
    dispatcher: insecureAgent,
  });
  const text = await res.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text); } catch { /* ignore */ }
  const data = (j?.data ?? j) as Record<string, unknown> | null;
  const token =
    (data?.token as string) ||
    (data?.access_token as string) ||
    (j?.token as string) ||
    (j?.access_token as string);
  if (!token) throw new Error(`auth/login بلا رمز (HTTP ${res.status})`);
  return token;
}

export async function loanLogin(username: string, password: string): Promise<string> {
  const errors: string[] = [];
  try {
    return await plainAuthLogin(username, password);
  } catch (e) {
    errors.push((e as Error).message);
  }
  // احتياط: تسجيل دخول SAS4 المشفّر على reseller/admin
  try {
    return await sasLogin(sasBaseUrl(RESELLER_HOST), username, password);
  } catch (e) {
    errors.push((e as Error).message);
  }
  throw new Error("فشل تسجيل الدخول إلى قروض سوبر سيل — تحقّق من اسم المستخدم وكلمة المرور. (" + errors.join(" | ") + ")");
}

// ---- سجلّ المشترك من الـreseller (شكلٌ مؤكَّد: username/loan_balance/enabled/expiration) ----
export interface LoanUserRecord {
  id: number;
  username: string;
  enabled: boolean;
  expiration: string | null;
  loanBalance: number;
  parentId: number | null;
}
export async function fetchLoanUserRecord(dealerToken: string, sasId: number): Promise<LoanUserRecord | null> {
  const base = sasBaseUrl(RESELLER_HOST); // https://reseller.scn-ftth.com/admin/api/index.php/api/
  try {
    const res = await undiciFetch(base + "user/" + sasId, {
      method: "GET",
      headers: { authorization: "Bearer " + dealerToken, accept: "application/json", "x-sas": X_SAS },
      dispatcher: insecureAgent,
    });
    if (!res.ok) return null;
    const j = JSON.parse(await res.text());
    const u = (j.data ?? j) as Record<string, unknown>;
    if (!u || u.username === undefined) return null;
    return {
      id: Number(u.id),
      username: String(u.username ?? ""),
      enabled: Number(u.enabled) === 1,
      expiration: (u.expiration as string) || null,
      loanBalance: Number(u.loan_balance ?? 0),
      parentId: u.parent_id != null ? Number(u.parent_id) : null,
    };
  } catch {
    return null;
  }
}

// ---- ملفّ notify: يُرجِع الرمز الخاصّ بالمشترك (المطلوب لطلب المنح) ----
async function fetchProfileToken(dealerToken: string, sasId: number): Promise<{ token: string | null; loanBalance: number; username: string | null }> {
  const res = await undiciFetch(NOTIFY_BASE + "manger-api/sas/UserProfile?userId=" + encodeURIComponent(String(sasId)), {
    method: "GET",
    headers: { authorization: "Bearer " + dealerToken, accept: "application/json", "x-sas": X_SAS },
    dispatcher: insecureAgent,
  });
  const text = await res.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text); } catch { /* ignore */ }
  const u = (j?.data ?? j) as Record<string, unknown> | null;
  return {
    token: (u?.token as string) || null,
    loanBalance: Number(u?.loan_balance ?? 0),
    username: (u?.username as string) ?? null,
  };
}

// ---- منح «فزعة» عبر الرمز الخاصّ ----
async function grantFazaa(profileToken: string): Promise<{ ok: boolean; status: number; message: string }> {
  const res = await undiciFetch(NOTIFY_BASE + "users/fzaa/activate", {
    method: "POST",
    headers: { authorization: "Bearer " + profileToken, accept: "application/json", "x-sas": X_SAS },
    dispatcher: insecureAgent,
  });
  const text = await res.text();
  let msg = "";
  try { const j = JSON.parse(text); msg = String((j?.message ?? j?.error ?? "")); } catch { msg = text.slice(0, 200); }
  return { ok: res.ok, status: res.status, message: msg };
}

export type LoanReason =
  | "login" | "no_record" | "mismatch" | "has_loan" | "not_expired" | "no_token" | "rejected" | "error";

export interface GrantLoanResult {
  ok: boolean;
  reason?: LoanReason;
  message?: string;
  verifiedUser?: string; // اليوزر المتحقَّق منه (للتدقيق)
  got?: string; // اليوزر العائد عند عدم المطابقة
  expiration?: string | null;
}

// المنح عالي المستوى — يُطبّق ضمانات الأمان الثلاثة ثم يمنح.
// expectedNetUser: يوزر المشترك المخزَّن عندنا (netUser). المطابقة إلزاميّة.
export async function grantLoan(opts: {
  loanUser: string;
  loanPass: string;
  sasId: number;
  expectedNetUser: string;
}): Promise<GrantLoanResult> {
  const { loanUser, loanPass, sasId, expectedNetUser } = opts;

  // ١) الدخول
  let dealerToken: string;
  try {
    dealerToken = await loanLogin(loanUser, loanPass);
  } catch (e) {
    return { ok: false, reason: "login", message: (e as Error).message };
  }

  // ٢) سجلّ المشترك (شكل مؤكَّد) — للمطابقة والأهليّة والقرض القائم
  const rec = await fetchLoanUserRecord(dealerToken, sasId);
  if (!rec) return { ok: false, reason: "no_record", message: "تعذّر قراءة سجلّ المشترك من سوبر سيل" };

  // حارس المطابقة الإلزاميّ — لو اختلف اليوزر بحرفٍ نُلغي بلا منح
  if (!eq(rec.username, expectedNetUser)) {
    return { ok: false, reason: "mismatch", message: "عدم تطابق هويّة المشترك — أُلغي المنح", got: rec.username };
  }

  // قرضٌ قائم لدى سوبر سيل
  if (rec.loanBalance && rec.loanBalance > 0) {
    return { ok: false, reason: "has_loan", message: "لدى المشترك قرضٌ غير مسدَّد", expiration: rec.expiration };
  }

  // الأهليّة: لا نمنع المحاولة بناءً على انتهاء الاشتراك (طلب محمد 2026-08-08). قد يُمنح القرض
  // لاشتراكٍ بقي له يومٌ واحد في بعض الحالات، وقد يكون عدّ الأيّام في برنامجنا خاطئاً (٢٠ يوماً
  // عندنا و٠ في الساس). سوبر سيل هي المرجع الأخير: إن كان فعلاً غير مؤهَّل ترفض المنح فنُبلّغ
  // رسالتها (reason=rejected)؛ حارسا المطابقة والقرض القائم أعلاه يبقيان كما هما.

  // ٣) الرمز الخاصّ بالمشترك من notify
  const prof = await fetchProfileToken(dealerToken, sasId);
  // تحقّق إضافيّ: لو أعاد notify يوزراً وخالف، نُلغي
  if (prof.username && !eq(prof.username, expectedNetUser)) {
    return { ok: false, reason: "mismatch", message: "عدم تطابق هويّة المشترك (notify) — أُلغي المنح", got: prof.username };
  }
  if (prof.loanBalance && prof.loanBalance > 0) {
    return { ok: false, reason: "has_loan", message: "لدى المشترك قرضٌ غير مسدَّد", expiration: rec.expiration };
  }
  if (!prof.token) return { ok: false, reason: "no_token", message: "تعذّر الحصول على رمز المشترك من سوبر سيل" };

  // ٤) المنح
  const g = await grantFazaa(prof.token);
  if (g.ok) return { ok: true, verifiedUser: rec.username, expiration: rec.expiration };
  if (/user has loans/i.test(g.message)) return { ok: false, reason: "has_loan", message: "لدى المشترك قرضٌ غير مسدَّد" };
  return { ok: false, reason: "rejected", message: g.message || `رفضت سوبر سيل المنح (HTTP ${g.status})` };
}

// اختبار الاتصال (لزرّ «اختبار» في إعداد المكتب): يسجّل الدخول ويقرأ عيّنة، بلا أيّ منح.
export async function testLoanConnection(opts: {
  loanUser: string;
  loanPass: string;
  sampleSasId?: number | null;
}): Promise<{ ok: boolean; step: string; message: string }> {
  let dealerToken: string;
  try {
    dealerToken = await loanLogin(opts.loanUser, opts.loanPass);
  } catch (e) {
    return { ok: false, step: "login", message: (e as Error).message };
  }
  if (opts.sampleSasId) {
    const rec = await fetchLoanUserRecord(dealerToken, opts.sampleSasId);
    if (!rec) return { ok: false, step: "record", message: "نجح الدخول لكن تعذّر قراءة سجلّ مشترك للتحقّق" };
    const prof = await fetchProfileToken(dealerToken, opts.sampleSasId);
    if (!prof.token) return { ok: true, step: "login+record", message: `نجح الدخول وقراءة السجلّ (${rec.username}) — لكن لم يُقرأ رمز المنح لهذه العيّنة` };
    return { ok: true, step: "full", message: `الاتصال سليم: دخول + سجلّ (${rec.username}) + رمز المنح جاهز` };
  }
  return { ok: true, step: "login", message: "نجح تسجيل الدخول إلى قروض سوبر سيل" };
}
