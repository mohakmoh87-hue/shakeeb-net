// ═════ 🏢📄 تكاملُ «موقع العقود» (SuperCell) — المصدرُ الموثوقُ للتنصيبات الداخليّة ═════
// طلبُ محمد 2026-09-05: موقعُ العقود يسرد تنصيباتِ المكتب (عقودَ الوكيل). نعتمده حصراً
// لعدِّ التنصيبات الداخليّة. الرابطُ **ثابتٌ لكلّ الوكلاء**؛ يختلف اليوزر/الباسورد فقط.
//
// الدخولُ خادميّاً عبر مسار NextAuth الرسميّ للموقع (لا عكسُ هندسةٍ خام):
//   csrf → callback/credentials (يضع كوكي الجلسة) → session (يُرجع توكن mng-api) → GetData.
// الأمانُ: المضيفان **ثابتان** في الكود (لا SSRF)، والباسورد يُخزَّن مشفَّراً في القاعدة.

const FIN = "https://finance.supercellnetwork.com";
const MNG = "https://mng-api.supercellnetwork.com";
const REQ_MS = 25_000; // مهلةُ كلّ نداءٍ — تمنع تعليقَ مهمّة الفحص (٤ نداءاتٍ ≤ ~١٠٠ث < مهلة إعادة العالق ٥د)
const timed = () => AbortSignal.timeout(REQ_MS);

type Jar = Map<string, string>;
function absorb(jar: Jar, res: Response): void {
  const getter = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getter === "function" ? getter.call(res.headers) : [];
  for (const c of cookies) { const m = /^([^=]+)=([^;]+)/.exec(c); if (m) jar.set(m[1].trim(), m[2].trim()); }
}
const cookieHeader = (jar: Jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

export class ContractsAuthError extends Error {}

/** دخولٌ باليوزر/الباسورد ⇒ توكنُ mng-api (JWT ~١٢س). يرمي ContractsAuthError عند فشل الاعتماد. */
export async function contractsLogin(username: string, password: string): Promise<string> {
  const jar: Jar = new Map();
  // ١) رمزُ CSRF + كوكي
  const csrfRes = await fetch(`${FIN}/api/auth/csrf`, { headers: { accept: "application/json" }, cache: "no-store", signal: timed() });
  absorb(jar, csrfRes);
  const csrfToken = (await csrfRes.json().catch(() => null))?.csrfToken as string | undefined;
  if (!csrfToken) throw new ContractsAuthError("تعذّر بدءُ الجلسة مع موقع العقود");
  // ٢) اعتمادُ الدخول — لا يُتَّبَع التحويلُ (redirect:false) والكوكي يعود في الرأس
  const body = new URLSearchParams({ csrfToken, username, password, redirect: "false", json: "true", callbackUrl: `${FIN}/contract` });
  const cbRes = await fetch(`${FIN}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual", signal: timed(),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar), accept: "application/json" },
    body,
  });
  absorb(jar, cbRes);
  // ٣) الجلسة ⇒ التوكن
  const sessRes = await fetch(`${FIN}/api/auth/session`, { headers: { cookie: cookieHeader(jar), accept: "application/json" }, cache: "no-store", signal: timed() });
  const sess = await sessRes.json().catch(() => null);
  const token = sess?.user?.session?.token as string | undefined;
  if (!token) throw new ContractsAuthError("يوزر أو باسورد موقع العقود غير صحيح");
  return token;
}

export type ContractRow = {
  id: number;
  accountNo: string | null;   // اسمُ المستخدم (netUser) — **الثابتُ الوحيدُ للمطابقة**
  ontNumber: string | null;   // السيريال
  fullName: string | null;
  createDateTime: string | null;
  subsPackageName: string | null;
  subsPackageTotalPrice: number | null;
  partialType: string | null;      // New | ReEngagementNew
  activationStatus: string | null;
  isRemoved?: boolean;
};

/** كلُّ عقود المكتب (٦٧٥ للشهداء مثلاً) بنداءٍ واحد. */
export async function contractsFetch(token: string): Promise<ContractRow[]> {
  const r = await fetch(`${MNG}/Contract/GetData`, {
    method: "POST", signal: timed(), headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}",
  });
  if (!r.ok) throw new Error(`Contract/GetData أرجع ${r.status}`);
  const j = await r.json().catch(() => null);
  const data = Array.isArray(j?.data) ? (j.data as ContractRow[]) : [];
  return data.filter((c) => !c.isRemoved);
}

/** دخولٌ + جلبٌ (للتحقّق والمزامنة). */
export async function contractsLoginAndFetch(username: string, password: string): Promise<ContractRow[]> {
  return contractsFetch(await contractsLogin(username, password));
}
