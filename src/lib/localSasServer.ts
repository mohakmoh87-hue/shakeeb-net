import http from "node:http";
import { prisma } from "@/lib/prisma";
import { proxyToSas } from "@/lib/sasProxy";
import { parseSasScope, sasScopeSegment } from "@/lib/sasScope";
import { sasBaseUrl, sasLogin, sasFetchOnePage, sasFetchActiveTotal, sasFetchOnlineCount, parseUsersList, type SasUser } from "@/lib/sas4";
import { getWorkerAgentId } from "@/lib/hybridAgent";
import { panelsOfTower, credsFromPanel, type SasCreds } from "@/lib/sasPanel";

// خادم محلي على حاسبة المكتب (المنفذ 47615): يخدم فحص الصحّة + لوحة SAS + عمليات SAS
// مباشرةً من الحاسبة القريبة من خادم SAS — فأسرع بكثير من المرور بـVercel (فرانكفورت).
// المتصفّح (على حاسبة المكتب) يتصل بـ http://127.0.0.1:47615 (localhost = سياق آمن، لا يُحجب).
const PORT = 47615;

// توكن SAS لكل مكتب (يُخزَّن دقائق لتفادي إعادة الدخول عند كل أصل من اللوحة)
const tokenCache = new Map<string, { token: string; at: number }>();
const TOKEN_TTL = 4 * 60 * 1000;
// آخرُ قائمةِ مشتركين عُرضت — **مفتاحُها النطاقُ لا المكتب** (`p11` / `t43`).
// 🔴 كان مفتاحُها `towerId`: فمكتبُ صميم بلوحتَين له **خانةٌ واحدة**، وتصفّحُ اللوحة الثانية
//   يطمس قائمةَ الأولى. فمن فتح اللوحتَين في تبويبَين ثمّ ضغط «عرض المعروض حاليّاً» على
//   الأولى استورد **مشتركي الثانية** — موسومين بـ`sasPanelId` الأولى (الواجهةُ تُرسل لوحةَ
//   تبويبها). أي بياناتٌ خاطئةٌ بصمت، وهي أسوأُ من رسالة خطأ.
const viewCache = new Map<string, { users: SasUser[]; at: number }>();
// المكتب/المضيف للّوحة المفتوحة حالياً — تستعمله نداءات اللوحة على /admin/* (بديل الكوكيز)
// و`panelId` جزءٌ منه: لوحتان قد تكونان على المُخدِّم نفسِه (صميم: كلتاهما على
// `82.129.22.22`) فالمضيفُ وحدَه لا يُميّزهما، ونداءاتُ اللوحة تحتاج **حسابَها**.
let currentPanel: { towerId: number; host: string; panelId: number | null } | null = null;

function cors(res: http.ServerResponse, origin?: string) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
}
function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); req.on("error", () => resolve(""));
  });
}

// مكتب يتبع وكيل هذه الحاسبة فقط (عزل)
// 🐌 **مخزونةٌ ٥ دقائق** (بلاغ محمد 2026-08-14: «فتح الساس بطيء منذ أكثر من يوم»):
// كانت تُنادى عند **كلّ** طلبِ `/sas` — مستندِ اللوحة وكلِّ أصلٍ من أصولها — باستعلامِ
// قاعدةٍ إلى Railway في أوروبا (~٢٠٠-٤٠٠م.ث من حاسبة المكتب) بعد أن حُذفت سابقتُها
// `agentTowerCached` في أ-٢٣/٥. والمهلةُ نفسُها مهلةُ `scopesCache` المجاور — فتغييرُ
// بياناتِ مكتبٍ يظهر خلال ٥ دقائق كما هو حالُ اللوحات سواء. والعزلُ كما هو حرفيّاً:
// الفحصُ نفسُه، خُزّنت نتيجتُه فقط (بما فيها السلبيّة — مكتبُ غيرِ الوكيل يبقى null).
type AgentTowerRow = { id: number; agentId: number | null; loginUrl: string | null; username: string | null; password: string | null } | null;
const agentTowerCache = new Map<number, { t: AgentTowerRow; at: number }>();
async function agentTower(towerId: number) {
  const hit = agentTowerCache.get(towerId);
  if (hit && Date.now() - hit.at < SCOPES_TTL) return hit.t;
  const aid = getWorkerAgentId();
  if (aid == null) return null; // لا وكيلَ بعد — لا يُخزَّن، فقد يُربَط بعد لحظات
  const row = await prisma.tower.findUnique({
    where: { id: towerId },
    select: { id: true, agentId: true, loginUrl: true, username: true, password: true },
  });
  const t: AgentTowerRow = row && row.agentId === aid && row.loginUrl && row.username && row.password ? row : null;
  agentTowerCache.set(towerId, { t, at: Date.now() });
  return t;
}
/** مفتاحُ الخزنِ لنطاقٍ واحد: لوحةٌ بعينها أو أعمدةُ المكتب (مَن لا لوحةَ له).
 *  نصٌّ لا رقمٌ لأنّ مُعرِّفَ لوحةٍ ومُعرِّفَ مكتبٍ قد يتساويان فيتصادم مخزناهما. */
const scopeKey = (c: { panelId: number | null; towerId: number }) =>
  c.panelId != null ? `p${c.panelId}` : `t${c.towerId}`;

// ═════ 🛡️ حارسُ `currentPanel`: النطاقُ من **مُحيل الطلب** لا من خانةٍ مشتركة ═════
//
// 🔴 العلّةُ (اصطدتُها بفحص أثر إصلاح الجسّ على صميم 2026-08-15): مُعالِجُ `/admin/*` العاري
//   يقرأ `currentPanel` — «آخرُ لوحةٍ فُتحت على هذه الحاسبة» — **وهو متغيّرٌ واحدٌ لكلّ
//   العمليّة**. ويُمرّر الطلبَ **بلا `authOverride`**، أي برمز المتصفّح كما هو. ورمزُ اللوحة
//   يسكن `localStorage.sas4_jwt` وهو **لكلّ المتصفّح** ⇒ فتحُ اللوحة الثانية يطمس رمزَ
//   الأولى، فيردّ الساسُ «Access Denied» في تبويبٍ لم يُلمَس. وهو **عينُ بلاغ صميم**
//   محروساً في الوسيط السحابيّ وفي مسار `/sas/` المحليّ، **ومكشوفاً هنا وحدَه**.
//
// 🔑 والمُحيلُ يحسمها: كلُّ تبويبٍ يحمل لوحتَه في مساره (`/sas/43~p11/…`)، فيصل `Referer`
//   موسوماً بلوحة **ذلك التبويب** — فلا خانةَ مشتركةً يُتقاتَل عليها.
// 🔒 وأمنيّاً: المُحيلُ يملكه المتصفّح فلا يُصدَّق. فهو **دلالةٌ لا إذن**: يُستخرَج منه
//   المكتبُ واللوحةُ ثمّ يُعادان إلى `agentTower` و`panelOfTower` — نفسُ بوّابتَي العزل
//   اللتين يمرّ بهما مسارُ `/sas/`. فمُحيلٌ مُختلَقٌ لمكتبِ وكيلٍ آخرَ يسقط كما يسقط هناك.
function scopeFromReferer(referer: string | undefined): { towerId: number; panelId: number | null } | null {
  if (!referer) return null;
  try {
    const m = new URL(referer).pathname.match(/^\/sas\/(\d+(?:~p\d+)?)(?:\/|$)/);
    if (!m) return null;
    const seg = parseSasScope(m[1]);
    return seg ? { towerId: seg.towerId, panelId: seg.panelId } : null;
  } catch { return null; }
}

async function scopeToken(c: SasCreds): Promise<string> {
  const k = scopeKey(c);
  const hit = tokenCache.get(k);
  if (hit && Date.now() - hit.at < TOKEN_TTL) return hit.token;
  const token = await sasLogin(sasBaseUrl(c.loginUrl), c.username, c.password);
  tokenCache.set(k, { token, at: Date.now() });
  return token;
}

async function towerToken(t: { id: number; loginUrl: string | null; username: string | null; password: string | null }): Promise<string> {
  const k = `t${t.id}`;
  const c = tokenCache.get(k);
  if (c && Date.now() - c.at < TOKEN_TTL) return c.token;
  const token = await sasLogin(sasBaseUrl(t.loginUrl!), t.username!, t.password!);
  tokenCache.set(k, { token, at: Date.now() });
  return token;
}

// ═════ عدّادُ «الفعّالين والمتصلين» يجمع **كلَّ لوحات المكتب** (بلاغُ محمد 2026-08-13) ═════
// 🔴 كان العدّادُ يمرّ على **المكاتب** ويستعمل أعمدةَ المكتب (الرابط/اليوزر/الباسورد)
//   — وهي أعمدةُ **لوحته الأولى** بعد أ-٢٣ (تُطابَق معها). فمكتبٌ بلوحتَين يُظهر
//   أرقامَ اللوحة الأولى وحدَها: «صميم ١» تُعَدّ و«صميم ٢» غائبةٌ تماماً — لا في
//   الفعّالين ولا في الكلّيّ ولا في المتصلين.
// ⇒ صار الجمعُ على **نطاقاتٍ**: لكلّ لوحةٍ نطاقُها ببياناتها وتوكنِها ومخزَنِها،
//   وبلا لوحاتٍ يبقى نطاقٌ واحدٌ من أعمدة المكتب (السلوكُ القديمُ حرفيّاً).
// 🔒 والعزلُ محفوظٌ: `agentTower` تُفحَص أوّلاً (المكتبُ يتبع وكيلَ هذه الحاسبة)
//   ثمّ تُقرأ لوحاتُه — فلا لوحةَ من مكتبٍ لا يملكه هذا العامل.
const scopesCache = new Map<number, { list: SasCreds[]; at: number }>();
const SCOPES_TTL = 5 * 60 * 1000; // لوحةٌ تُضاف/تُحذف تظهر خلال ٥ دقائق بلا إعادة تشغيل

/** بياناتُ لوحةٍ بعينها **إن كانت لهذا المكتب** — وإلّا `null`.
 *  🔒 هذا هو موضعُ العزل: مُعرِّفُ اللوحة يأتي من الرابط (يملكه المستخدم)، فلا يُقبَل
 *  إلّا بعد إثباتِ أنّه لوحةُ المكتب المفحوصِ سلفاً بـ`agentTower` (وكيلُ هذه الحاسبة). */
async function panelOfTower(towerId: number, panelId: number): Promise<SasCreds | null> {
  const list = await scopesOfTower(towerId);
  return list.find((c) => c.panelId === panelId) ?? null;
}

async function scopesOfTower(towerId: number): Promise<SasCreds[]> {
  const hit = scopesCache.get(towerId);
  if (hit && Date.now() - hit.at < SCOPES_TTL) return hit.list;
  const list: SasCreds[] = [];
  const t = await agentTower(towerId); // 🔒 العزل: مكتبُ وكيلِ هذه الحاسبة حصراً
  if (t) {
    for (const p of await panelsOfTower(towerId)) {
      const c = credsFromPanel(p);
      if (c) list.push(c);
    }
    // بلا لوحاتٍ (أو كلُّها ناقصةُ البيانات): أعمدةُ المكتب — السلوكُ القديم
    if (!list.length) {
      list.push({
        panelId: null, towerId: t.id, agentId: t.agentId, label: null,
        loginUrl: t.loginUrl!, username: t.username!, password: t.password!, activationTemplate: null,
      });
    }
  }
  scopesCache.set(towerId, { list, at: Date.now() });
  return list;
}

// ===== عدّاد المشتركين (أ5): فعالين/كلي محلياً بالكامل — يقرأ من SAS المكتب فقط =====
// شرط محمد: التحديث كل 5 ثوانٍ يجب ألا يمرّ على Azure/Aiven إطلاقاً لتقليل الاستهلاك.
// لذا بيانات المكتب (الرابط/اليوزر/الباسورد) تُقرأ من القاعدة مرة واحدة لعمر العملية
// وتُخزَّن بالذاكرة، والأرقام تأتي من مسح مخزون SAS المخزّن مؤقتاً (تجديد كل 45 ثانية).
// (حُذفت `agentTowerCached` ومخزنُها: صارت `scopesOfTower` تخزّن **قائمةَ النطاقات**
//  فتُغني عنها — وبقاءُ دالّةٍ ميْتةٍ تقرأ أعمدةَ المكتب وحدَها يُوهم قارئاً لاحقاً
//  بأنّ «بياناتُ المكتب» كافيةٌ للعدّ، وهي عينُ العلّة التي أخفت أرقامَ صميم ٢.)

const statsCache = new Map<string, { active: number; total: number; at: number }>();
const statsInflight = new Map<string, Promise<void>>();
const STATS_TTL = 45_000; // مسح SAS كل 45 ثانية كحد أقصى (المتصفّح يستطلع كل 5 ثوانٍ من الكاش)
// «المتصلين الآن»: طلب واحد خفيف (count=1) يتجدّد مع كل استطلاع (كل 5 ثوانٍ) — شبكة المكتب المحلية
const onlineCache = new Map<string, { online: number | null; at: number }>();
const ONLINE_TTL = 4_500;

async function refreshScopeStats(c: SasCreds): Promise<void> {
  const base = sasBaseUrl(c.loginUrl);
  const token = await scopeToken(c);
  // نداءان رخيصان بدل جلبِ كلّ المستخدمين (كان حتى ١٥٠٠٠ سجلّ يعبر السحابةَ لكلّ حساب).
  // «فعال» = status:1 في الساس (نفسُ «Active» في لوحته)؛ والكلّي من `index/user` بلا فلتر.
  const { active, total } = await sasFetchActiveTotal(base, token);
  statsCache.set(scopeKey(c), { active, total, at: Date.now() });
}

/** أرقامُ نطاقٍ واحدٍ من المخزن، ويُجدَّد إن قدُم. `null` = لم يُمسح بعد.
 *  و`awaitFirst` للطلب الأوّل: ننتظر المسحَ مرّةً ثمّ نخدم من المخزن ونُجدّد بالخلفية. */
async function scopeStats(c: SasCreds, awaitFirst: boolean): Promise<{ active: number; total: number; at: number } | null> {
  const k = scopeKey(c);
  const cached = statsCache.get(k);
  if (!cached || Date.now() - cached.at > STATS_TTL) {
    if (!statsInflight.has(k)) {
      statsInflight.set(k, refreshScopeStats(c)
        .catch(() => { tokenCache.delete(k); scopesCache.delete(c.towerId); agentTowerCache.delete(c.towerId); }) // توكن/بياناتٌ فاسدة: تُجدَّد بالمحاولة التالية
        .finally(() => statsInflight.delete(k)));
    }
    if (!cached && awaitFirst) { try { await statsInflight.get(k); } catch { /* يُخدَم بلا أرقامٍ لهذا النطاق */ } }
  }
  return statsCache.get(k) ?? null;
}

/** «المتصلون الآن» لنطاقٍ واحد — طلبٌ خفيفٌ يتجدّد كلَّ استطلاعٍ تقريباً. */
async function scopeOnline(c: SasCreds, ttl: number): Promise<number | null> {
  const k = scopeKey(c);
  let oc = onlineCache.get(k);
  if (!oc || Date.now() - oc.at > ttl) {
    try {
      const token = await scopeToken(c);
      oc = { online: await sasFetchOnlineCount(sasBaseUrl(c.loginUrl), token), at: Date.now() };
    } catch { oc = { online: oc?.online ?? null, at: Date.now() }; }
    onlineCache.set(k, oc);
  }
  return oc.online;
}

// تحويل طلب Node إلى Request ويب (لإعادة استخدام proxyToSas)
function toWebRequest(req: http.IncomingMessage, bodyBuf: Buffer | undefined): Request {
  const url = `http://127.0.0.1:${PORT}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  return new Request(url, { method: req.method, headers, body: bodyBuf && bodyBuf.length ? new Uint8Array(bodyBuf) : undefined });
}

async function pushStatsToCloud(): Promise<void> {
  const aid = getWorkerAgentId();
  if (aid == null) { console.log("[stats-push] بلا وكيل بعد — تأجيل الرفعة"); return; }
  const towers = await prisma.tower.findMany({
    where: { agentId: aid, isDeleted: false, loginUrl: { not: null }, username: { not: null }, password: { not: null } },
    select: { id: true },
  });
  const offices: Record<string, { active: number; total: number; online: number | null }> = {};
  // تشخيص لكل مكتب فشل — يُكتب مع الرفعة كي يُعرف السبب من القاعدة عن بُعد
  const diag: Record<string, string> = {};
  for (const t of towers) {
    try {
      // الرفعةُ تجمع على **لوحات المكتب** مثلَ العدّاد المحليّ — وإلّا لَظهرت في السحابة
      // أرقامُ اللوحة الأولى وحدَها لمكتبٍ بلوحتَين (وهي عينُ علّة العدّاد المحليّ).
      const scopes = await scopesOfTower(t.id);
      if (!scopes.length) { diag[t.id] = "بيانات SAS ناقصة أو المكتب غير تابع"; continue; }
      let active = 0, total = 0, online: number | null = null, gotAny = false;
      const fails: string[] = [];
      for (const c of scopes) {
        try {
          const sc = await scopeStats(c, true);
          if (sc) { active += sc.active; total += sc.total; gotAny = true; }
          else fails.push(`${c.label ?? scopeKey(c)}: لا مخزون إحصاء بعد`);
        } catch (e) { fails.push(`${c.label ?? scopeKey(c)}: ${e instanceof Error ? e.message : String(e)}`); }
        // «المتصلين» اختياريٌّ — لا يُفشل الرفعة، ومهلتُه أطولُ هنا (دقيقة) لا ٤٫٥ث
        const on = await scopeOnline(c, 60_000).catch(() => null);
        if (on != null) online = (online ?? 0) + on;
      }
      if (gotAny) offices[t.id] = { active, total, online };
      // التشخيصُ يُذكر **باسم اللوحة** فيُعرف أيُّ لوحةٍ فشلت لا «المكتب» مبهماً
      if (fails.length) diag[t.id] = fails.join(" · ");
      else if (!gotAny) diag[t.id] = "لا مخزون إحصاء بعد";
    } catch (e) { diag[t.id] = e instanceof Error ? e.message : String(e); }
  }
  // الرفعة تُكتب دائماً (حتى بلا مكاتب) — وجود السطر بحد ذاته يثبت أن كود الرفع
  // يعمل على الحاسبة، وdiag يشرح أي فشل. وتُدمج مع مكاتب الحاسبات الأخرى: كل حاسبة
  // مكتبٍ ترى SAS مكتبها فقط، فالكتابة الساحقة كانت ستمحو أرقام المكتب الآخر بالتناوب.
  const type = `subStats:${aid}`;
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true, text: true } });
  let prev: { offices?: Record<string, unknown>; diag?: Record<string, string> } = {};
  try { prev = row?.text ? JSON.parse(row.text) : {}; } catch { /* نص فاسد — نبدأ نظيفاً */ }
  const mergedOffices = { ...(prev.offices ?? {}), ...offices };
  const mergedDiag: Record<string, string> = { ...(prev.diag ?? {}), ...diag };
  for (const id of Object.keys(mergedOffices)) delete mergedDiag[id]; // مكتب له أرقام لا يحتاج تشخيصاً
  const text = JSON.stringify({
    at: new Date().toISOString(),
    offices: mergedOffices,
    ...(Object.keys(mergedDiag).length ? { diag: mergedDiag } : {}),
  });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
  console.log(`[stats-push] ✓ رُفعت أرقام ${Object.keys(offices).length} مكتب` +
    (Object.keys(diag).length ? ` — إخفاقات: ${JSON.stringify(diag)}` : ""));
}

/** يُرجع وعداً يُحلَّ **عند نجاح الحجز** — فالعاملُ ينتظره ليعرف أنّه صاحبُ هذه الحاسبة
 *  **قبل** أن يقتل متصفّحاً أو يُشغّل مُجدولاً. وعند `EADDRINUSE` لا يُحَلُّ أبداً (العمليّةُ تخرج). */
export function startLocalSasServer(onBusy: "exit" | "yield" = "exit"): Promise<boolean> {
  const g = globalThis as unknown as { __localSasStarted?: boolean };
  if (g.__localSasStarted) return Promise.resolve(true); // نحن حاجزوه في هذه العمليّة
  g.__localSasStarted = true;
  let ready: (owned: boolean) => void = () => {};
  const started = new Promise<boolean>((res) => { ready = res; });

  // رفع الخلاصة للقاعدة كل 5 دقائق (وأول رفعة بعد 45 ثانية من الإقلاع) —
  // فشل الرفعة يُطبع في نافذة العامل (كان يُبلع صامتاً فتعذّر التشخيص) —
  // ليراها محمد من أي مكان (قراءة كل 5 دقائق)؛ حمل الخطة المجانية: سطر upsert لا غير
  const pushLogged = () => pushStatsToCloud().catch((e) => console.error("[stats-push] ✗ فشلت الرفعة:", e instanceof Error ? e.message : e));
  setTimeout(() => { void pushLogged(); }, 45_000);
  setInterval(() => { void pushLogged(); }, 5 * 60 * 1000);

  const server = http.createServer(async (req, res) => {
    cors(res, req.headers.origin as string | undefined);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    try {
      // فحص الصحّة + معرّف الوكيل
      if (p.startsWith("/health")) { sendJson(res, 200, { ok: true, agent: "shakeeb-net", agentId: getWorkerAgentId() }); return; }

      // بروكسي لوحة SAS: /sas/:towerId/...  (يحقن التوكن في HTML للدخول التلقائي، ويلتقط قوائم العرض)
      // المقطعُ يقبل `43` و`43~p11` — والثانيةُ تحمل اللوحةَ في المسار نفسِه
      const panel = p.match(/^\/sas\/(\d+(?:~p\d+)?)\/?(.*)$/);
      if (panel) {
        const seg = parseSasScope(panel[1]);
        if (!seg) { res.writeHead(400); res.end("bad tower"); return; }
        const towerId = seg.towerId;
        const t = await agentTower(towerId);
        if (!t) { res.writeHead(404); res.end("tower not allowed"); return; }

        // ═════ 🔴 بلاغُ صميم 2026-08-13: «Access Denied من الساس نفسِه» ═════
        // كان هذا الوسيطُ **يتجاهل `?panel=` تماماً**: يقرأ أعمدةَ المكتب (`agentTower`)
        // ويحقن رمزَها — وهي أعمدةُ **اللوحة الأولى**. فمَن فتح تفعيلَ مشتركٍ على اللوحة
        // الثانية سُجِّل بحساب الأولى، فيضع الكارتَ ويضغط «تفعيل» فيرفض الساسُ العمليّةَ
        // لأنّ الحسابَ المُسجَّلَ لا يملك ذلك المستخدم. (والوسيطُ السحابيُّ كان يقرأه
        // سلفاً — فالعلّةُ في المحليِّ وحدَه، وهو ما تعمل عليه حاسباتُ المكاتب.)
        // 🔒 والعزل: `panelOfTower` تقبل اللوحةَ **إن كانت لهذا المكتب** فحسب، والمكتبُ
        //    فُحص أعلاه بـ`agentTower` (وكيلُ هذه الحاسبة) ⇒ لا لوحةَ من مكتبٍ آخر.
        // الأولويّة للمسار: هو ملكُ التبويب ويورَّث للطلبات النسبيّة، والمعاملُ يسقط بعد
        // أوّل تحميلٍ فتعود اللوحةُ للخانة المشتركة (وهو ارتدادُ بلاغ صميم بعينه).
        const wantPanel = seg.panelId ?? (Number(url.searchParams.get("panel")) || null);
        const pc = wantPanel ? await panelOfTower(towerId, wantPanel) : null;
        // بلا لوحةٍ مطلوبةٍ (أو لوحةٍ لا تتبع المكتب) ⇒ أعمدةُ المكتب: السلوكُ القديم حرفيّاً
        const creds: SasCreds = pc ?? {
          panelId: null, towerId: t.id, agentId: t.agentId, label: null,
          loginUrl: t.loginUrl!, username: t.username!, password: t.password!, activationTemplate: null,
        };
        const host = (creds.loginUrl || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        // ⚠️ ويُحفَظ **مُعرِّفُ اللوحة** مع المضيف: لوحتان قد تكونان على المُخدِّم نفسِه
        //   (صميم: كلتاهما `82.129.22.22`) فالمضيفُ وحدَه لا يُميّزهما، ونداءاتُ `/admin/*`
        //   تحتاج رمزَ اللوحة الصحيحة لا مضيفَها فقط.
        currentPanel = { towerId, host, panelId: creds.panelId }; // تُستعمل في نداءات /admin/*
        const bodyBuf = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.from(await readBody(req));
        const webReq = toWebRequest(req, bodyBuf);
        let capturedJson: string | null = null;
        const scoped = sasScopeSegment(towerId, creds.panelId);
        const webRes = await proxyToSas(webReq, host, panel[2] || "", `/sas/${scoped}/`, (txt) => { capturedJson = txt; },
          () => scopeToken(creds)); // 🔑 رمزُ **هذه** اللوحة يُفرَض على كلّ نداءٍ محمولٍ بمسارها
        // التقاط قائمة المشتركين المعروضة
        if (capturedJson) { try { const us = parseUsersList(capturedJson); if (us.length) viewCache.set(scopeKey(creds), { users: us, at: Date.now() }); } catch { /* */ } }
        const ct = webRes.headers.get("content-type") || "";
        let bodyText: Buffer;
        if (ct.includes("text/html")) {
          // حقن التوكن في localStorage قبل تحميل سكربتات اللوحة (دخول تلقائي)
          // 🔴 رمزُ **اللوحة المطلوبة** لا أعمدةِ المكتب — وهو جوهرُ إصلاح بلاغ صميم:
          //   كان `towerToken(t)` يُسجّل بحساب اللوحة الأولى دائماً، فيرفض الساسُ
          //   العمليّةَ على مشتركِ اللوحة الثانية بـ«Access Denied».
          const token = await scopeToken(creds).catch(() => "");
          // 🔑 موسومٌ باللوحة: كان `/admin/...` جذراً فيُوجَّه بمتغيّرٍ عامٍّ واحدٍ («آخرُ لوحةٍ
          //   فُتحت») ⇒ تبويبان مفتوحان يتقاتلان عليه فيردّ الساسُ «Access Denied» على
          //   تبويبٍ لم يُلمَس. والآن كلُّ نداءٍ يحمل لوحتَه في مساره، فلا خانةَ مشتركة.
          const apiUrl = `/sas/${scoped}/admin/api/index.php/api/`;
          let html = await webRes.text();
          const inject = `<script>try{localStorage.setItem('sas4_jwt',${JSON.stringify(token)});localStorage.setItem('sas4_api_url',${JSON.stringify(apiUrl)});}catch(e){}</script>`;
          html = html.replace(/<head[^>]*>/i, (m) => m + inject);
          bodyText = Buffer.from(html);
        } else {
          bodyText = Buffer.from(await webRes.arrayBuffer());
        }
        res.setHeader("Content-Type", ct);
        res.writeHead(webRes.status);
        res.end(bodyText);
        return;
      }

      // ═════ 🏢📄 تحقّقُ اعتماد موقع العقود — من حاسبة المكتب حصراً (طلب محمد 2026-09-05) ═════
      // موقعُ العقود يُفتَح من إنترنت سوبر سيل فقط، والخادمُ السحابيُّ لا يصله. فالتحقّقُ يجري
      // هنا (حاسبةُ المكتب على شبكة سوبر سيل) بدخولٍ فعليٍّ وجلبِ عددِ العقود.
      if (p === "/contracts-verify" && req.method === "POST") {
        let body: { username?: string; password?: string } = {};
        try { body = JSON.parse(await readBody(req)); } catch { /* يفشل التحقّق أدناه */ }
        const username = String(body.username ?? "").trim();
        const password = String(body.password ?? "");
        if (!username || !password) { sendJson(res, 400, { error: "أدخل اليوزر والباسورد" }); return; }
        const { contractsLoginAndFetch, ContractsAuthError } = await import("@/lib/contractsApi");
        try {
          const rows = await contractsLoginAndFetch(username, password);
          sendJson(res, 200, { ok: true, count: rows.length });
        } catch (e) {
          if (e instanceof ContractsAuthError) sendJson(res, 401, { error: e.message });
          else sendJson(res, 502, { error: "تعذّر الاتصال بموقع العقود (تأكّد أنّك على إنترنت سوبر سيل)" });
        }
        return;
      }

      // ═════ 🖨️ طباعةٌ محليّةٌ فوريّة (طلب محمد 2026-08-14): «٥ ثوانٍ كبيرةٌ جدّاً» ═════
      // المتصفّحُ على حاسبة المكتب يُرسل هنا مباشرةً (إرسالٌ لحظيّ) بدل انتظار مستطلِع
      // طابور الـ٥ ثوانٍ. وإن لم تكن هذه الحاسبةُ مالكةَ مكتبِ الوصل ⇒ 409 فيرتدّ الزرُّ
      // للطابور السحابيّ فتطبعه مالكتُه (نفسُ قواعد ملكيّة المستطلِع حرفيّاً — فلا يُطبع
      // وصلُ مكتبٍ على طابعة مكتبٍ آخرَ أبداً). ومنعُ ازدواجٍ مزدوج: صفُّ dedup الـ٢٠ثانية
      // + الالتقاطُ الذرّيُّ داخل processJob (pending→printing) — فلو تداخل المساران طُبع مرّة.
      if (p === "/print" && req.method === "POST") {
        const aid = getWorkerAgentId();
        if (aid == null) { sendJson(res, 503, { error: "الحاسبة غير مربوطة بوكيل بعد" }); return; }
        let body: { kind?: string; id?: number } = {};
        try { body = JSON.parse(await readBody(req)); } catch { /* يفشل التحقّق أدناه */ }
        const kind = String(body.kind ?? "");
        const refId = Number(body.id);
        if (!["subscription", "invoice", "debt"].includes(kind) || !Number.isInteger(refId) || refId <= 0) {
          sendJson(res, 400, { error: "بيانات غير صحيحة" }); return;
        }
        // مكتبُ الوصل — نفسُ استخراج المسار السحابيّ (ومعه شرطُ نوعِ قيدِ الدين)
        let towerId: number | null = null;
        if (kind === "subscription") {
          const e = await prisma.subscriptionEntry.findUnique({ where: { id: refId }, select: { towerId: true } });
          if (!e) { sendJson(res, 404, { error: "الوصل غير موجود" }); return; }
          towerId = e.towerId;
        } else if (kind === "debt") {
          const tx = await prisma.moneyTx.findUnique({ where: { id: refId }, select: { towerId: true, sourceType: true } });
          if (!tx) { sendJson(res, 404, { error: "القيد غير موجود" }); return; }
          if (tx.sourceType !== "debt" && tx.sourceType !== "master-debt") { sendJson(res, 400, { error: "هذا القيد ليس تسديد دين" }); return; }
          towerId = tx.towerId;
        } else {
          const inv = await prisma.invoice.findUnique({ where: { id: refId }, select: { towerId: true } });
          if (!inv) { sendJson(res, 404, { error: "الفاتورة غير موجودة" }); return; }
          towerId = inv.towerId;
        }
        // 🔒 العزل: مكتبُ الوصل من مكاتب وكيلِ هذه الحاسبة حصراً
        const tw = towerId != null ? await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } }) : null;
        if (towerId == null || tw?.agentId !== aid) { sendJson(res, 403, { error: "الوصل لا يتبع وكيل هذه الحاسبة" }); return; }
        // ملكيّةُ المكتب — قواعدُ مستطلِع الطابور نفسُها: مالكةُ جلسة واتسابه، وإلّا حاملةُ
        // جلسته محليّاً، وإلّا القائدُ (حالة «لا مالكةَ مسجّلة»). غيرُ المالكة ⇒ ارتدادٌ للسحابة.
        const mid = process.env.MACHINE_ID || null;
        const wa = await prisma.waSession.findUnique({ where: { towerId }, select: { hostMachineId: true } }).catch(() => null);
        const { hostsOfficeLocally } = await import("@/lib/whatsapp");
        const { isLeaderNow } = await import("@/lib/hybridAgent");
        const mine = wa?.hostMachineId != null
          ? (mid != null && wa.hostMachineId === mid)
          : (hostsOfficeLocally(towerId) || isLeaderNow());
        if (!mine) { sendJson(res, 409, { error: "ليست هذه حاسبةَ مكتب الوصل — يُطبع عبر الطابور" }); return; }
        // صفُّ الأمر أوّلاً (نفسُ dedup الـ٢٠ ثانية) — فالسجلُّ واحدٌ مهما كان المسار
        const recent = await prisma.printJob.findFirst({
          where: { kind, refId, createdAt: { gte: new Date(Date.now() - 20_000) } },
          orderBy: { id: "desc" },
        });
        const job = recent ?? await prisma.printJob.create({ data: { agentId: aid, towerId, kind, refId } });
        const { processJob } = await import("@/lib/printAgent");
        await processJob(job); // الالتقاطُ الذرّيُّ داخلها — إن سبقها المستطلِعُ فلا شيءَ يُعاد
        const done = await prisma.printJob.findUnique({ where: { id: job.id }, select: { status: true, error: true } });
        sendJson(res, 200, { ok: done?.status === "done", jobId: job.id, status: done?.status ?? "?", error: done?.error ?? null, local: true });
        return;
      }

      // بروكسي نداءات API للّوحة: /admin/*  — نطاقُه من **مُحيل التبويب** ثمّ `currentPanel`
      if (p.startsWith("/admin/") || p === "/admin") {
        // 🛡️ الحارس: تبويبٌ يحمل لوحتَه في مساره ⇒ مُحيلُه يقول لوحتَه. والمشتركُ آخرَ ملاذ.
        const ref = scopeFromReferer(req.headers.referer as string | undefined);
        let creds: SasCreds | null = null;
        if (ref) {
          // 🔒 نفسُ بوّابتَي العزل: المكتبُ لوكيل هذه الحاسبة، واللوحةُ لهذا المكتب
          const t = await agentTower(ref.towerId);
          if (t) {
            creds = ref.panelId != null ? await panelOfTower(ref.towerId, ref.panelId) : null;
            if (!creds) creds = {
              panelId: null, towerId: t.id, agentId: t.agentId, label: null,
              loginUrl: t.loginUrl!, username: t.username!, password: t.password!, activationTemplate: null,
            };
          }
        }
        // بلا مُحيلٍ صالح: اللوحةُ المفتوحةُ حاليّاً — السلوكُ القديم حرفيّاً (توافقٌ مع
        // تبويباتٍ مفتوحةٍ الآن وطلباتٍ بلا مُحيل)، لكنّه صار الملاذَ لا القاعدة.
        if (!creds && currentPanel) {
          const t = await agentTower(currentPanel.towerId);
          if (t) {
            creds = currentPanel.panelId != null ? await panelOfTower(currentPanel.towerId, currentPanel.panelId) : null;
            if (!creds) creds = {
              panelId: null, towerId: t.id, agentId: t.agentId, label: null,
              loginUrl: t.loginUrl!, username: t.username!, password: t.password!, activationTemplate: null,
            };
          }
        }
        if (!creds) { res.writeHead(404); res.end("no panel"); return; }
        const host = (creds.loginUrl || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        const bodyBuf = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.from(await readBody(req));
        const webReq = toWebRequest(req, bodyBuf);
        const upstreamPath = p.replace(/^\//, ""); // admin/...
        let capturedJson: string | null = null;
        // 🔑 **والرمزُ يُفرَض** — وهذا نصفُ الحارس الآخر: كان هذا المُعالِجُ يُمرّر رمزَ
        //   المتصفّح كما هو (بلا `authOverride`)، ورمزُ اللوحة يسكن `localStorage` المشترك
        //   فتطمسه اللوحةُ الثانية. فصار كلُّ نداءٍ يحمل رمزَ **لوحته هو** مهما كان في
        //   المتصفّح — كما يفعل مسارُ `/sas/` والوسيطُ السحابيّ سواءً بسواء.
        const scoped: SasCreds = creds;
        const webRes = await proxyToSas(webReq, host, upstreamPath, undefined, (txt) => { capturedJson = txt; },
          () => scopeToken(scoped));
        if (capturedJson && upstreamPath.endsWith("index/user")) {
          try { const us = parseUsersList(capturedJson); if (us.length) viewCache.set(scopeKey(scoped), { users: us, at: Date.now() }); } catch { /* */ }
        }
        const ct = webRes.headers.get("content-type") || "";
        res.setHeader("Content-Type", ct);
        res.writeHead(webRes.status);
        res.end(Buffer.from(await webRes.arrayBuffer()));
        return;
      }

      // عدّاد المشتركين (أ5): مجموع فعالين/كلي لمكاتب محدّدة — من كاش مسح SAS المحلي.
      // ?towers=1,2,3 — يتجاهل أي مكتب لا يتبع وكيل هذه الحاسبة (عزل).
      if (p === "/stats/subscribers" && req.method === "GET") {
        const ids = (url.searchParams.get("towers") || "")
          .split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (!ids.length) { sendJson(res, 400, { error: "towers مطلوب" }); return; }
        let active = 0, total = 0, oldest = Date.now(), any = false;
        let online = 0, onlineKnown = false;
        for (const id of ids) {
          // 🔴 بلاغُ محمد: مكتبٌ بلوحتَي ساس كان يُظهر أرقامَ **الأولى** وحدَها («صميم ١»)
          //   لأنّ العدّادَ يقرأ أعمدةَ المكتب — وهي أعمدةُ لوحته الأولى. فالجمعُ الآن
          //   على كلّ لوحاته، ولكلّ لوحةٍ توكنُها ومخزَنُها (فلوحتان بتوكنٍ واحدٍ تُرجعان
          //   قائمةَ واحدةٍ منهما).
          for (const c of await scopesOfTower(id)) {
            const s = await scopeStats(c, true); // أوّلُ طلبٍ ينتظر المسحَ مرّةً
            if (s) { active += s.active; total += s.total; oldest = Math.min(oldest, s.at); any = true; }
            const on = await scopeOnline(c, ONLINE_TTL);
            if (on != null) { online += on; onlineKnown = true; }
          }
        }
        if (!any) { sendJson(res, 404, { error: "لا مكاتب صالحة" }); return; }
        sendJson(res, 200, { active, total, online: onlineKnown ? online : null, at: oldest });
        return;
      }

      // ===== عمليات البيانات (JSON) =====
      // ⚠️ هذان المساران كانا يقرآن **أعمدةَ المكتب** = بيانات اللوحة الأولى دائماً، فمكتبٌ
      //   بلوحتَين يُجيبهما بحساب الأولى مهما طُلبت الثانية — وهو **نمطُ بلاغ صميم بعينه**
      //   («الاستيرادُ من الساس الثاني يُظهر مشتركي الأوّل»)، أُصلح في المسار السحابيّ ونُسي
      //   هنا. وهما اليومَ بلا مستهلكٍ في الواجهة، لكنّ إصلاحَ الجسّ يزيد المرورَ المحلّيَّ
      //   فتُترَك مصيدةٌ مفتوحة. ⇒ صارا يقبلان `panelId` ويرتدّان لأعمدة المكتب بلاه.
      if (p === "/sas4/token" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const towerId = Number(b.towerId);
        const t = await agentTower(towerId);
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const want = Number(b.panelId) || null;
        // 🔒 اللوحةُ تُقبَل إن كانت لهذا المكتب حصراً (والمكتبُ فُحص أعلاه)
        const c = want ? await panelOfTower(towerId, want) : null;
        if (want && !c) { sendJson(res, 403, { error: "اللوحة لا تتبع هذا المكتب" }); return; }
        const token = c ? await scopeToken(c) : await towerToken(t);
        sendJson(res, 200, { token, apiUrl: `/sas/${sasScopeSegment(towerId, c?.panelId ?? null)}/admin/api/index.php/api/` });
        return;
      }
      if (p === "/sas4/fetch" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const towerId = Number(b.towerId);
        const t = await agentTower(towerId);
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const want = Number(b.panelId) || null;
        const c = want ? await panelOfTower(towerId, want) : null;
        if (want && !c) { sendJson(res, 403, { error: "اللوحة لا تتبع هذا المكتب" }); return; }
        const base = sasBaseUrl(c ? c.loginUrl : t.loginUrl!);
        const token = c ? await scopeToken(c) : await towerToken(t);
        const { users, total, lastPage } = await sasFetchOnePage(base, token, Number(b.page) || 1, Number(b.count) || 50);
        // 🔒 و«مستوردٌ سلفاً» يُقاس داخل هذا المكتب وغيرَ محذوف — لا في كلّ مكاتب كلّ
        //   الوكلاء (وهي علّةُ `last-view` نفسُها التي أُصلحت هناك ونُسيت هنا).
        const existing = await prisma.subscriber.findMany({
          where: { sasId: { in: users.map((u) => u.sasId) }, towerId, isDeleted: false }, select: { sasId: true },
        });
        const ex = new Set(existing.map((e) => e.sasId));
        sendJson(res, 200, { total, lastPage, page: Number(b.page) || 1, count: Number(b.count) || 50, users: users.map((u) => ({ ...u, alreadyImported: ex.has(u.sasId) })) });
        return;
      }
      if (p === "/sas4/last-view" && req.method === "GET") {
        const towerId = Number(url.searchParams.get("towerId"));
        // 🔒 والعزلُ أوّلاً: المكتبُ لوكيل هذه الحاسبة — وإلّا قُرئ عرضُ مكتبِ وكيلٍ آخر
        if (!(await agentTower(towerId))) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        // لوحةُ التبويب الطالب: تُقرأ من المعامل (ترسله الواجهة) ثمّ من مُحيله — ولكلّ
        // لوحةٍ خانتُها، فلا تُعطى قائمةُ اللوحة الثانية لمن يستورد من الأولى.
        const askedPanel = Number(url.searchParams.get("panelId")) || null;
        const refScope = scopeFromReferer(req.headers.referer as string | undefined);
        const panelId = askedPanel ?? (refScope?.towerId === towerId ? refScope.panelId : null);
        const v = viewCache.get(scopeKey({ towerId, panelId }))
          // ارتدادٌ للتوافق: عرضٌ التُقط قبل هذه النشرة (أو لوحةٌ واحدة) خُزّن بمفتاح المكتب
          ?? (panelId == null ? viewCache.get(scopeKey({ towerId, panelId: null })) : undefined);
        if (!v || !v.users.length) { sendJson(res, 400, { error: "لم تُعرض أي صفحة في اللوحة بعد. تصفّح المشتركين في اللوحة ثم أعد المحاولة." }); return; }
        // 🔴 نفسُ علّة الخادم (بلاغُ محمد 2026-08-13) **وأوسع**: كان بلا `isDeleted` وبلا
        // `towerId` ⇒ (١) المحذوفُ ناعماً يُعَدُّ «مستورداً» فتُقفَل شاشةُ الاستيراد عليه،
        // و(٢) `sasId` يُطابَق في **كلّ مكاتب كلّ الوكلاء** — قراءةٌ عابرةٌ للعزل تقفل
        // استيرادَ مشتركك بمشترك وكيلٍ آخر. **والمحذوفُ ليس مستورداً — هو محذوف.**
        const existing = await prisma.subscriber.findMany({ where: { sasId: { in: v.users.map((u) => u.sasId) }, towerId, isDeleted: false }, select: { sasId: true } });
        const ex = new Set(existing.map((e) => e.sasId));
        sendJson(res, 200, { towerId, users: v.users.map((u) => ({ ...u, alreadyImported: ex.has(u.sasId) })) });
        return;
      }
      if (p === "/sas4/sync" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const t = await agentTower(Number(b.towerId));
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
        sendJson(res, 200, await runOfficeSyncAll(t.id, { notify: false }));
        return;
      }

      res.writeHead(404); res.end("not found");
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    // ═════ ب-١/الأصل ٣ · حارسُ النسخة الواحدة — إغلاقُ نافذة السباق ═════
    // 🔴 **كان `EADDRINUSE` يُبتلَع صامتاً** فيُكمل العاملُ عملَه **بلا خادمه المحلّيّ**، وهو
    // أسوأُ ما يمكن: عاملان على حاسبةٍ واحدةٍ ⇒ **تذكيرانِ للمشتركين · بريدا نسخةٍ احتياطيّةٍ
    // · مزامنتا SAS**، و`killOrphanBrowsers` في الثاني **يقتل متصفّحاتِ الأوّل** فتُفقَد
    // جلساتُ الواتساب.
    //
    // 🔑 وحارسُ `worker.ts:ensureSingleInstance` **لا يكفي وحدَه** ولا يُلام: يفحص المنفذَ
    // بمِسبارٍ **ثمّ يُغلقه فوراً** — ولا بدّ من إغلاقه لأنّ هذا الخادمَ يحجز **نفسَ المنفذ**
    // (٤٧٦١٥). فبين الفحص والحجز نافذةُ سباقٍ: عاملان يبدآن معاً فيمرّان كلاهما من المِسبار،
    // ثمّ يحجز أحدُهما ويفشل الآخرُ **صامتاً** فيعمل معطوباً.
    // ⇒ **فالحجزُ الفعليُّ هو القفل**: فشلُه يعني أنّ عاملاً آخرَ يملك هذه الحاسبة ⇒ نخرج.
    //   (خروجٌ بـ0 لأنّه ليس خطأً بل تنازلٌ مقصود؛ و`worker-loop.cmd` لا يُعيده في حلقةٍ
    //    عبثيّةٍ إلّا إن حُرّرَ المنفذُ فعلاً — وذلك هو المطلوب.)
    // ✅ وآمنٌ لأنّ هذا الخادمَ لا يعمل إلّا حيث `RUN_WORKER=1` (حاسباتُ المكاتب) — لا في
    //   خادم الموقع على Railway، فلا يُمَسّ الموقعُ أبداً.
    if (e.code === "EADDRINUSE") {
      console.error(`[local-sas] ⛔ المنفذ ${PORT} محجوزٌ — عاملُ SHAKEEB يعمل بالفعل على هذه الحاسبة.`);
      if (onBusy === "exit") {
        console.error("[local-sas] إيقافُ هذه النسخة لمنع تنفيذٍ مزدوج (تذكيرٌ ونسخةٌ ومزامنةٌ مرّتَين).");
        process.exit(0);
      }
      // `yield`: عمليّةٌ تخدم صفحاتٍ (خادمُ Next) — لا تُقتَل، بل تتنازل عن الوظائف الخلفيّة
      // وحدَها. فالخروجُ هنا يُسقط الموقعَ المحليَّ كلَّه بلا سبب.
      console.error("[local-sas] تنازلٌ عن الوظائف الخلفيّة لهذه العمليّة (الصفحاتُ تبقى تعمل).");
      ready(false);
      return;
    }
    console.error("[local-sas]", e.message);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[local-sas] خادم SAS المحلي يعمل على http://127.0.0.1:${PORT}`);
    ready(true); // ✅ حُجز المنفذُ فعلاً ⇒ هذه النسخةُ هي صاحبةُ الحاسبة
  });
  return started;
}
