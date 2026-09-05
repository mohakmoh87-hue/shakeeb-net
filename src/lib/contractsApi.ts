// ═════ 🏢📄 تكاملُ «موقع العقود» (SuperCell) — المصدرُ الموثوقُ للتنصيبات الداخليّة ═════
// طلبُ محمد 2026-09-05: موقعُ العقود يسرد تنصيباتِ المكتب (عقودَ الوكيل). نعتمده حصراً
// لعدِّ التنصيبات الداخليّة. الرابطُ **ثابتٌ لكلّ الوكلاء**؛ يختلف اليوزر/الباسورد فقط.
//
// الدخولُ **مباشرةً على mng-api** كما تفعل الصفحة نفسُها: POST /Security/User/Session/Login
//   بـ{username,password} (JSON) ⇒ الردُّ فيه session.token ⇒ يُستعمل Bearer لـ Contract/GetData.
// الأمانُ: المضيفُ **ثابتٌ** في الكود (لا SSRF)، والباسورد يُخزَّن مشفَّراً في القاعدة.

const MNG = "https://mng-api.supercellnetwork.com";
const REQ_MS = 25_000; // مهلةُ كلّ نداء
const timed = () => AbortSignal.timeout(REQ_MS);

export class ContractsAuthError extends Error {}

/** دخولٌ باليوزر/الباسورد ⇒ توكنُ mng-api (JWT ~١٢س). يرمي ContractsAuthError عند فشل الاعتماد. */
export async function contractsLogin(username: string, password: string): Promise<string> {
  const r = await fetch(`${MNG}/Security/User/Session/Login`, {
    method: "POST", signal: timed(),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const text = await r.text().catch(() => "");
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* ليس JSON */ }
  const token = pickToken(j);
  if (token) return token;
  const apiMsg = String(j?.message ?? j?.error ?? j?.title ?? "").slice(0, 90);
  if (r.ok) throw new ContractsAuthError(`تشخيص: دخلَ بلا توكن — مفاتيح: ${j ? Object.keys(j).join(",") : "لا JSON"}`);
  if (r.status === 400 || r.status === 401) throw new ContractsAuthError(apiMsg ? `رُفض الدخول: ${apiMsg}` : "يوزر أو باسورد موقع العقود غير صحيح");
  throw new ContractsAuthError(`تعذّر الدخول لموقع العقود (HTTP ${r.status}${apiMsg ? " — " + apiMsg : ""})`);
}

// التوكن قد يكون في session.token (كما رأينا في الجلسة) أو token/accessToken أو داخل data
function pickToken(j: Record<string, unknown> | null): string | undefined {
  if (!j) return undefined;
  const g = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
  const cands = [
    g(g(j, "session"), "token"), g(j, "token"), g(j, "accessToken"),
    g(g(j, "user"), "session") && g(g(g(j, "user"), "session"), "token"),
    g(g(j, "data"), "token"), g(g(g(j, "data"), "session"), "token"),
  ];
  const t = cands.find((x) => typeof x === "string" && x.length > 20);
  return typeof t === "string" ? t : undefined;
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
