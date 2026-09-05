// ═════ 🏢📄 تكاملُ «موقع العقود» (SuperCell) — المصدرُ الموثوقُ للتنصيبات الداخليّة ═════
// طلبُ محمد 2026-09-05: موقعُ العقود يسرد تنصيباتِ المكتب (عقودَ الوكيل). نعتمده حصراً
// لعدِّ التنصيبات الداخليّة. الرابطُ **ثابتٌ لكلّ الوكلاء**؛ يختلف اليوزر/الباسورد فقط.
//
// الدخولُ عبر **بوّابة NextAuth الخاصّة بالموقع** (finance) لا مباشرةً على mng-api: صفحةُ الدخول
// تستدعي signIn("credentials") فقط باليوزر/الباسورد، وواجهةُ NextAuth على الخادم هي التي تُضيف
// device/oSName/platform وتنادي mng-api. فنُحاكي هذه البوّابة (csrf ← callback ← session)
// ونأخذ توكنَ mng-api من الجلسة (user.session.token) — فلا نحتاج قيمةَ platform الخفيّة.
// الأمانُ: المضيفان **ثابتان** في الكود (لا SSRF)؛ الباسورد يُخزَّن نصّاً صريحاً كباسوردِ الساس.

const MNG = "https://mng-api.supercellnetwork.com";
const FIN = "https://finance.supercellnetwork.com";
const REQ_MS = 25_000; // مهلةُ كلّ نداء
const timed = () => AbortSignal.timeout(REQ_MS);

export class ContractsAuthError extends Error {}

// ترويساتٌ تحاكي المتصفّح
const browserHeaders = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "accept-language": "ar,en;q=0.9",
};

function addCookies(jar: Record<string, string>, setCookies: string[]): void {
  for (const sc of setCookies) {
    const first = sc.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
}
const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

/** دخولٌ عبر بوّابة NextAuth ⇒ توكنُ mng-api من الجلسة. يرمي ContractsAuthError عند فشل الاعتماد. */
export async function contractsLogin(username: string, password: string): Promise<string> {
  const jar: Record<string, string> = {};

  // ١) csrf: توكنٌ + كوكي csrf
  const rc = await fetch(`${FIN}/api/auth/csrf`, { signal: timed(), headers: browserHeaders });
  addCookies(jar, rc.headers.getSetCookie?.() ?? []);
  const cj = await rc.json().catch(() => null) as { csrfToken?: string } | null;
  const csrfToken = cj?.csrfToken;
  if (!csrfToken) throw new ContractsAuthError("تعذّر تهيئةُ الدخول لموقع العقود (csrf)");

  // ٢) callback/credentials: NextAuth ينادي mng-api (بـplatform الصحيحة) ويضع كوكيَّ الجلسة عند النجاح
  const form = new URLSearchParams({ csrfToken, username, password, callbackUrl: `${FIN}/`, json: "true" });
  const rl = await fetch(`${FIN}/api/auth/callback/credentials`, {
    method: "POST", signal: timed(), redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar), ...browserHeaders },
    body: form.toString(),
  });
  addCookies(jar, rl.headers.getSetCookie?.() ?? []);
  const hasSession = Object.keys(jar).some((k) => /next-auth\.session-token/.test(k));
  if (!hasSession) {
    const bt = await rl.text().catch(() => "");
    if (/error=|CredentialsSignin/i.test(bt) || rl.status === 401) throw new ContractsAuthError("يوزر أو باسورد موقع العقود غير صحيح");
    throw new ContractsAuthError(`تعذّر الدخول لموقع العقود (HTTP ${rl.status})`);
  }

  // ٣) session: توكنُ mng-api في user.session.token
  const rs = await fetch(`${FIN}/api/auth/session`, { signal: timed(), headers: { cookie: cookieHeader(jar), ...browserHeaders } });
  const sj = await rs.json().catch(() => null);
  const token = pickToken(sj);
  if (!token) throw new ContractsAuthError("تمّ الدخول لكن تعذّر جلبُ توكن الجلسة");
  return token;
}

// التوكن في user.session.token (كما يقرأه الموقعُ نفسُه) مع بدائلَ احتياطيّة
function pickToken(j: unknown): string | undefined {
  const g = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
  const cands = [
    g(g(g(j, "user"), "session"), "token"),
    g(g(j, "session"), "token"), g(j, "token"), g(j, "accessToken"),
    g(g(j, "user"), "token"), g(g(j, "data"), "token"),
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
