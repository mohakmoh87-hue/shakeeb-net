import path from "path";
import fs from "fs";
import type { Client as WAClient } from "whatsapp-web.js";
import { prisma } from "@/lib/prisma";
import { scrubRelayImage } from "@/lib/relayScrub"; // 🧹 نزعُ الصورة من صفّ الترحيل بعد تنفيذه

// ===== خدمة واتساب ويب متعددة المكاتب (whatsapp-web.js) =====
// عميل مستقل لكل مكتب (officeId)، يبقى حيّاً عبر إعادة تحميل الوحدات عبر globalThis.
// جلسة كل مكتب تُحفَظ محلياً (LocalAuth clientId = office-{id}).

export type WaState = "disconnected" | "starting" | "qr" | "authenticated" | "ready" | "error";

type WaStore = {
  client: WAClient | null;
  state: WaState;
  qr: string | null;
  lastError: string | null;
  startedAt: number | null;
  retries: number; // عدد محاولات إعادة التشغيل عند العُلوق (starting/authenticated)
  qrAt: number | null; // لحظةُ آخرِ رمزِ QR وصل من واتساب — لكشف الرمز المتجمّد
  cooldownUntil: number | null; // هدنةٌ بعد استنفاد المحاولات — تنتهي وحدَها فيُستأنف
  probedAt: number | null; // آخرُ مسبارِ جهوزيّةٍ حقيقيّ (getState) — لا يُسأل كلَّ نبضة
  probeFails: number; // فشلان متتاليان قبل الهدم — فمسبارٌ بطيءٌ عابرٌ لا يهدم جلسةً سليمة
  // ═════ 🩹 سُلَّمُ الشفاء الذاتيّ (حلُّ مكتب المهندس الجذريّ — طلب محمد 2026-08-21) ═════
  // كان استنفادُ المحاولات يفتح هدنةً ثمّ يعيد المحاولةَ **بنفس الملفّات المعطوبة** إلى
  // الأبد. الآن كلُّ استنفادٍ متتالٍ يصعّد درجةً: هدنة ← تنظيفُ ذاكرة نسخة واتساب ويب
  // (.wwebjs_cache — لا تمسّ الربطَ ولا تحتاج QR) ← إعادةُ ضبط الجلسة تلقائيّاً (مرّةً
  // كلَّ ٢٤ ساعةً حدّاً أقصى) مع إشعارِ مدراء الوكيل أنّ الرمزَ بانتظار المسح.
  exhaustions: number; // استنفاداتٌ متتالية (تُصفَّر عند ready أو وصول QR حيّ)
  lastAutoResetAt: number | null; // آخرُ إعادة ضبطٍ تلقائيّة — صمّامُ «مرّة كلّ ٢٤ ساعة»
};

// ═════ 🔴 عالٍ (د) · مسبارُ الجهوزيّة الحقيقيّ (المسحُ العدائيّ 2026-08-19) ═════
// نبضةُ الصحّة كانت تُجدّد ختمَ «متصل» بفحص **المتغيّرِ المخزونِ نفسِه** الذي نحرس من
// جموده — فإن مات كروميوم بلا حدثِ disconnected (عينُ حادثتَي الشهداء ٣ آب والشدن
// «Target closed») بقيت الحالةُ «ready» تُوثَّق كذباً كلَّ ٨ ثوانٍ، وكلُّ إرسالٍ يفشل،
// ولا مخرجَ إلّا إعادةُ تشغيلٍ يدويّة — حالةٌ بالِعةٌ من عائلة رمزِ صميم نفسِها.
// 🔑 الآن يُسأل **العميلُ نفسُه** (getState بمهلة) كلَّ دقيقة، وبفشلَين متتاليَين يُهدَم
//   ويُعلَن disconnected فيلتقطه حارسُ الإنعاش فوراً — وملفّاتُ الجلسة على القرص تُعيده
//   بلا QR. وفشلٌ واحدٌ يوقف تجديدَ الختم فقط (فيصدق الموقعُ «غيرَ متصل» مبكراً).
const PROBE_EVERY_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
// ═════ 🔴 بلاغ محمد 2026-08-20: «بعض جلسات الواتساب تهدم بلا سبب» ═════
// الجاني «Navigating frame was detached»: صفحةُ واتساب تتنقّل داخليّاً بين الحين
// والحين، وgetState لحظتَها يرمي أخطاءَ **عابرةً** (frame detached · execution
// context destroyed) لا تعني موتَ العميل — وكان المسبارُ يعدّها فشلاً، وفشلان
// متتاليان يهدمان جلسةً حيّةً سليمة. صار المسبارُ ثلاثيَّ الدرجات:
//   alive = CONNECTED · transient = خطأُ تنقّلٍ عابرٌ (لا يُحتسب ولا يُجدَّد الختم)
//   dead = مهلةٌ أو Target closed أو حالةٌ غيرُ متصلة (يُحتسب نحو الهدم كالسابق)
type ProbeResult = "alive" | "transient" | "dead";
const TRANSIENT_PROBE_RE = /navigating frame was detached|frame was detached|execution context was destroyed|cannot find context with specified id/i;
async function probeClientAlive(client: WAClient): Promise<ProbeResult> {
  try {
    const state = await Promise.race([
      Promise.resolve(client.getState()),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("probe-timeout")), PROBE_TIMEOUT_MS)),
    ]);
    return state === "CONNECTED" ? "alive" : "dead";
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return TRANSIENT_PROBE_RE.test(m) ? "transient" : "dead";
  }
}
// يفحص جهوزيّةَ مكتبٍ حالتُه «ready» — ويهدم العميلَ الميّتَ بعد فشلَين متتاليَين.
// يُرجع true إن كانت الجلسةُ جديرةً بتجديد ختمِ «متصل».
async function ensureReadyIsReal(officeId: number): Promise<boolean> {
  const st = store(officeId);
  if (st.state !== "ready" || !st.client) return false;
  const now = Date.now();
  if (st.probedAt != null && now - st.probedAt < PROBE_EVERY_MS) return st.probeFails === 0;
  st.probedAt = now;
  const probe = await probeClientAlive(st.client);
  if (probe === "alive") { st.probeFails = 0; return true; }
  if (probe === "transient") {
    // خطأُ تنقّلٍ عابر: لا يُحتسب فشلاً ولا يُهدَم شيء — وجلسةٌ كانت سليمةً تُبقي
    // ختمَها حتى الدورة القادمة (فلا «غير متصل» كاذبةً على وميضِ تنقّل)
    console.log(`[whatsapp] ⏳ مسبارُ مكتب ${officeId}: تنقّلٌ عابرٌ في الصفحة — لا يُحتسب`);
    return st.probeFails === 0;
  }
  st.probeFails += 1;
  console.log(`[whatsapp] ⚠️ مسبارُ مكتب ${officeId} فشل (${st.probeFails}/2) — الحالةُ «ready» والعميلُ لا يُجيب`);
  if (st.probeFails >= 2) {
    console.log(`[whatsapp] 💀 عميلُ مكتب ${officeId} ميّتٌ فعلاً — يُهدَم ويُعاد وصلُه من ملفّاته`);
    try { st.client.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
    st.client = null; st.state = "disconnected"; st.qr = null; st.qrAt = null; st.probeFails = 0;
    publish(officeId);
  }
  return false;
}

// ═════ 🔴 «خطأ» لم تعد نهايةَ الطريق (بلاغُ الشدن 2026-08-15) ═════
//
// رأى محمد على حاسبة الشدن: «Protocol error (Runtime.callFunctionOn): Target closed»
// — أي أنّ كروميوم مات أثناء الإقلاع.
//
// 🔴 وكان عدّادُ المحاولات `retries` **لا يُصفَّر إلّا عند بلوغ «متصل»**. فبعد ثلاث
//   محاولاتٍ فاشلة يبقى العدّادُ ٣ ما دامت العمليّةُ حيّة، فكلُّ محاولةٍ لاحقةٍ
//   تُعلَن خطأً فوراً **حتى لو زال السببُ تماماً** (فرغت مساحةُ القرص مثلاً).
//   ⇒ المستخدم يُصلح السببَ ولا يتبدّل شيءٌ حتى يُعيد تشغيل البرنامج يدويّاً.
//
// 🔑 والعلاج مسارُ خروجٍ مضمون، لا تصفيرٌ ساذج:
//   · التصفيرُ عند **تقدّمٍ حقيقيّ** (رمزٌ وصل أو جهوزيّة) — فكروميوم يعمل ⇒ العطلُ زال.
//   · واستنفادُ المحاولات يفتح **هدنةً** لا نهايةً: يُصفَّر العدّادُ وتُضبط مهلةٌ،
//     فإذا انقضت استُؤنفت المحاولاتُ من جديدٍ تلقائيّاً.
//
// ⚠️ ولماذا الهدنةُ لا «التصفيرُ بعد هدوء»: حارسَ الدورة يُعيد المحاولةَ كلَّ ~٦٠ث،
//   فلا يهدأ شيءٌ أبداً ولا يمرّ شرطُ الهدوء ⇒ لكانت العلّةُ باقيةً بثوبٍ آخر.
//   والهدنةُ ١٠ دقائق: طويلةٌ فلا تُرهق حاسبةً معطوبةً بكروميوم كلَّ دقيقة،
//   وقصيرةٌ فلا ينتظر المستخدمُ طويلاً بعد إصلاح السبب.
const COOLDOWN_MS = 10 * 60_000;

// ═════ 🔴 الرمزُ المتجمّد: «QR ما يحدّث نفسه» (بلاغُ محمد عن صميم 2026-08-15) ═════
//
// واتسابُ يُدوّر رمزَ الربط كلَّ ~٢٠ ثانية ويُطلق الحدثَ `qr` في كلّ مرّة. فإن تعطّلت
// صفحةُ كروميوم أو عَلِقت، تتوقّف الأحداثُ ويبقى آخرُ رمزٍ في الذاكرة **إلى الأبد**.
//
// وكانت `qr` **حالةً بالِعة** لا مخرجَ منها، في ثلاثة مواضعَ معاً:
//   · `startWhatsApp` يرى الحالةَ `qr` فيرجع فوراً بلا إعادة تشغيل
//   · وحارسا الدورة (المربوطة وغيرُ المربوطة) يَعُدّان `qr` حياةً فلا يُنعشان شيئاً
// ⇒ فالمستخدم يمسح رمزاً ميّتاً، ويُعيد المسحَ، ولا يتبدّل شيءٌ أبداً. وهو ما وصفه
//   محمد حرفيّاً: «فقط يبقى ثابت على الكيو ار واحد وميحدث».
//
// والحدُّ ١٢٠ ثانيةً = ستُّ دوراتِ تدويرٍ فائتة. فتأخُّرُ دورةٍ أو دورتَين على شبكةٍ
// بطيئةٍ لا يهدم جلسةً سليمة، وتوقُّفٌ حقيقيٌّ يُكشَف خلال دقيقتَين.
const QR_STALE_MS = 120_000;
function qrStuck(s: WaStore): boolean {
  return s.state === "qr" && s.qrAt != null && Date.now() - s.qrAt > QR_STALE_MS;
}

const g = globalThis as unknown as { __waOffices?: Map<number, WaStore> };
function offices(): Map<number, WaStore> {
  if (!g.__waOffices) g.__waOffices = new Map();
  return g.__waOffices;
}
function store(officeId: number): WaStore {
  const m = offices();
  if (!m.has(officeId)) {
    m.set(officeId, { client: null, state: "disconnected", qr: null, lastError: null, startedAt: null, retries: 0, qrAt: null, cooldownUntil: null, probedAt: null, probeFails: 0, exhaustions: 0, lastAutoResetAt: null });
  }
  return m.get(officeId)!;
}

const SESSION_DIR = path.join(process.cwd(), ".wwebjs_auth");

// نشر حالة/رمز الواتساب لهذا المكتب إلى السحابة (Neon) ليقرأها الموقع ويعرض الـQR من الإنترنت
function publish(officeId: number) {
  const s = store(officeId);
  // ملكية حصرية: بلوغ "ready" على هذه الحاسبة يسجّلها مالكةً للجلسة — فتحذف بقية
  // الحواسيب نسخها القديمة ذاتياً (يمنع تقاتل حاسبتين على نفس الجلسة وإبطالها من واتساب)
  const mid = process.env.MACHINE_ID || null;
  const own = s.state === "ready" && mid ? { hostMachineId: mid } : {};
  prisma.waSession.upsert({
    where: { towerId: officeId },
    update: { state: s.state, qr: s.qr, error: s.lastError, ...own },
    create: { towerId: officeId, state: s.state, qr: s.qr, error: s.lastError, ...own },
  }).catch(() => { /* لا نُفشل الواتساب بسبب النشر */ });
}

// تهيئة وبدء اتصال واتساب لمكتب محدّد (idempotent)
const STARTUP_TIMEOUT_MS = 75_000; // إن لم يظهر QR/يجهز خلال هذه المدة نعتبر الإقلاع عالقاً

export async function startWhatsApp(officeId: number): Promise<WaState> {
  const s = store(officeId);
  // جاهز/يعرض QR → أعِد الحالة كما هي
  // 🔑 والرمزُ المتجمّد مستثنى: كانت `qr` تُرجِع فوراً مهما طال جمودُها، فلا يُنعَش أبداً.
  if (s.client && (s.state === "ready" || s.state === "authenticated" || (s.state === "qr" && !qrStuck(s)))) {
    return s.state;
  }
  // هدنةٌ سارية: لا تُرهق حاسبةً معطوبةً بإقلاعِ كروميوم كلَّ دورة
  if (s.cooldownUntil && Date.now() < s.cooldownUntil && !s.client) {
    return s.state;
  }
  if (qrStuck(s)) {
    console.log(`[whatsapp] ♻️ رمزُ مكتب ${officeId} متجمّدٌ منذ أكثرَ من دقيقتَين — إعادةُ تشغيل`);
    s.lastError = "الرمزُ توقّف عن التجدّد — أُعيد التشغيل";
  }

  // ═════ لا تُستضاف جلسةٌ لا يحتاجها أحد (تدقيقُ 2026-08-13) ═════
  // 🔴 وُجد صفُّ جلسةٍ بحالة `qr` **لمكتبٍ محذوف** (المواصلات ٣) بلا مضيفٍ إطلاقاً —
  //   متصفّحٌ وذاكرةٌ ورمزٌ يُولَّد لمكتبٍ لم يعد موجوداً، ويُحصى «غير متصل» أبداً.
  // 🔑 و**الشرطُ ليس `waEnabled` وحدَه**: مكتبُ الشهداء واتسابُه مُطفأٌ للمشتركين لكنّ
  //   له **رقمَ مدير**، وتقريرُ المدير يُرسَل عبر واتساب ⇒ **يحتاج الجلسةَ بحقّ**.
  //   فالمنعُ لمن لا يحتاجه لشيء: مُطفأٌ **ولا رقمَ مدير**. (ولولا هذا القيدُ لَقطعتُ
  //   تقريرَ مديرِ مكتبَين — قِيسا: الشهداء ٦ والتقنيات الضوئيّة ٤٠.)
  // ⚠️ وأُلغيَ شقُّ «مُطفأٌ ولا رقمَ مدير» بطلب محمد — يبقى حارسُ **المحذوف** وحدَه،
  //   وهو سببُ الصفِّ اليتيم الذي وُجد فعلاً (المواصلات ٣ بحالة `qr` بلا مضيف).
  const office = await prisma.tower.findUnique({
    where: { id: officeId },
    select: { isDeleted: true },
  }).catch(() => null);
  if (office) {
    if (office.isDeleted) {
      s.state = "disconnected";
      s.qr = null;
      s.lastError = "المكتب محذوف";
      // ويُنظَّف الصفُّ المنشورُ كي لا يبقى «qr» أبداً في كلّ عدٍّ وشاشة
      await prisma.waSession.updateMany({
        where: { towerId: officeId },
        data: { state: "disconnected", qr: null, error: s.lastError },
      }).catch(() => {});
      return s.state;
    }
  }
  // ما زال يقلع حديثاً → دعه يكمل
  if (s.client && s.state === "starting" && s.startedAt && Date.now() - s.startedAt < STARTUP_TIMEOUT_MS) {
    return s.state;
  }
  // إقلاع عالق/قديم (Chromium لم يستجب) → اهدم العميل وأعد التشغيل من جديد
  if (s.client) {
    try { s.client.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
    s.client = null;
  }
  s.state = "starting";
  s.qr = null;
  s.lastError = null;
  s.startedAt = Date.now();

  // تنظيف ملفات القفل العالقة من إغلاق سابق غير نظيف (انطفاء مفاجئ/تعطّل)،
  // وإلا يعلّق كروميوم عند البدء ولا يظهر رمز QR.
  try {
    const dir = path.join(SESSION_DIR, `session-office-${officeId}`);
    for (const lock of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const f = path.join(dir, lock);
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
  } catch { /* تجاهل */ }

  // شفاء ذاتي: قتل أي كروم يتيم ما يزال ماسكاً جلسة هذا المكتب تحديداً (بقايا عملية
  // أُوقفت قسراً أثناء تحديث/انهيار) — يمنع خطأ "The browser is already running for
  // ...session-office-X" الذي يحجب فتح الواتساب حتى بعد إعادة تشغيل العامل.
  // آمن: عميلنا لهذا المكتب دُمِّر أعلاه، ولا عامل آخر على نفس الحاسبة (قفل المنفذ).
  if (process.platform === "win32") {
    try {
      const { execSync } = await import("node:child_process");
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*session-office-${officeId}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: "ignore", timeout: 20000 },
      );
    } catch { /* لا شيء ليُقتل أو تعذّر — نتابع */ }
  }

  console.log(`[whatsapp] بدء إقلاع واتساب مكتب ${officeId}...`);
  // تحميل المكتبة (CJS) بأمان: نجرّب require المباشر أولاً (يعمل مع tsx/Node)،
  // ثم import مع مراعاة تداخل default — لأن الصادرات قد تُوضَع تحت default.
  let Client: typeof import("whatsapp-web.js").Client;
  let LocalAuth: typeof import("whatsapp-web.js").LocalAuth;
  try {
    const pick = (o: unknown): Record<string, unknown> | null => {
      const r = o as Record<string, unknown> | null;
      return r && (typeof r.Client === "function" || typeof r.LocalAuth === "function") ? r : null;
    };
    let mod: Record<string, unknown> | null = null;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(path.join(process.cwd(), "wa-require.cjs"));
      mod = pick(req("whatsapp-web.js"));
    } catch { /* نجرّب import أدناه */ }
    if (!mod) {
      const wa = (await import("whatsapp-web.js")) as unknown as Record<string, unknown>;
      mod = pick(wa) ?? pick(wa.default) ?? pick((wa.default as Record<string, unknown>)?.default);
    }
    if (!mod) throw new Error("Client/LocalAuth غير متاحين من whatsapp-web.js (interop)");
    Client = mod.Client as typeof Client;
    LocalAuth = mod.LocalAuth as typeof LocalAuth;
  } catch (e) {
    s.state = "error";
    s.lastError = `فشل تحميل مكتبة الواتساب: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[whatsapp] ❌", s.lastError);
    publish(officeId);
    return s.state;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `office-${officeId}`, dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
  });

  client.on("loading_screen", (percent: string, message: string) => { console.log(`[whatsapp] مكتب ${officeId} تحميل ${percent}% ${message ?? ""}`); });
  client.on("qr", (qr: string) => { const st = store(officeId); st.qr = qr; st.state = "qr"; st.qrAt = Date.now(); st.retries = 0; st.cooldownUntil = null; st.exhaustions = 0; publish(officeId); console.log(`[whatsapp] ✅ QR جاهز لمكتب ${officeId}`); });
  client.on("authenticated", () => { const st = store(officeId); st.qr = null; st.state = "authenticated"; publish(officeId); console.log(`[whatsapp] مكتب ${officeId} تم التوثيق — بانتظار الجهوزية`); });
  client.on("ready", () => {
    const st = store(officeId); st.qr = null; st.state = "ready"; st.retries = 0; st.cooldownUntil = null; st.probeFails = 0; st.probedAt = null; st.exhaustions = 0;
    publish(officeId);
    console.log(`[whatsapp] ✅ مكتب ${officeId} جاهز`);
    // البند ٤-ب · تصريفُ طابور «فعّل بنفسه» لحظةَ جهوزيّة الواتساب (نصُّ الطلب:
    // «الطابورُ يُرسَل عند اشتغال الحاسبة والواتساب»). وتأخيرٌ قصيرٌ لتستقرّ الجلسةُ
    // قبل أوّل إرسال — فالإرسالُ على «ready» مباشرةً يفشل أحياناً والجلسةُ لم تُثبَّت.
    setTimeout(() => {
      void import("@/lib/selfActivatedNotice")
        .then((m) => m.drainSelfActivatedQueue(officeId))
        .then((r) => { if (r.sent || r.expired) console.log(`[wa-queue] مكتب ${officeId}: أُرسل ${r.sent} · مُسح ${r.expired} · فشل ${r.failed}`); })
        .catch(() => {});
      // 📨 وطابورُ رسائل سجلّ المزامنة (طلب محمد 2026-08-21): «يُرسَل فورَ اشتغال
      // الحاسبة» — لا يُمسَح أبداً، فتفريغُه هنا هو موعدُ وصول ما تراكم ليلاً
      void import("@/lib/syncAutoMsg")
        .then((m) => m.drainSyncMsgQueue(officeId))
        .then((r) => { if (r.sent) console.log(`[syncmsg-queue] مكتب ${officeId}: أُرسل ${r.sent} · باقٍ ${r.waiting}`); })
        .catch(() => {});
    }, 15_000);
  });
  client.on("auth_failure", (m: string) => { const st = store(officeId); st.state = "error"; st.lastError = `فشل المصادقة: ${m}`; publish(officeId); });
  client.on("disconnected", (reason: string) => { const st = store(officeId); st.state = "disconnected"; st.lastError = `انقطع الاتصال: ${reason}`; st.client = null; publish(officeId); });

  s.client = client;
  publish(officeId); // نشر حالة "starting"
  const startedFor = s.startedAt;
  client.initialize().catch((e: unknown) => {
    const st = store(officeId);
    st.state = "error";
    st.lastError = e instanceof Error ? e.message : String(e);
    try { st.client?.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
    st.client = null;
    publish(officeId);
  });
  // مراقب العُلوق: إن بقي في "starting" أو "authenticated" (لم يصل "ready") بعد المهلة:
  // نُعيد المحاولة تلقائياً حتى 3 مرّات (يُصلح العُلوق عند تزاحم عدّة مكاتب)، ثم نُعلن خطأً.
  setTimeout(() => {
    const st = store(officeId);
    const stuck = st.startedAt === startedFor && (st.state === "starting" || st.state === "authenticated");
    if (!stuck) return;
    try { st.client?.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
    st.client = null;
    if (st.retries < 3) {
      st.retries += 1;
      console.log(`[whatsapp] مكتب ${officeId} عالق على "${st.state}" — إعادة محاولة (${st.retries}/3)`);
      st.state = "disconnected";
      void startWhatsApp(officeId);
    } else {
      // 🔑 هدنةٌ لا نهاية: تُصفَّر الميزانيّةُ الآن وتُضبط مهلة، فإذا انقضت
      //   استُؤنفت المحاولاتُ تلقائيّاً بلا تدخّلٍ من أحد.
      // 🩹 وسُلَّمُ التصعيد (حلّ المهندس الجذريّ 2026-08-21): الاستنفادُ الثاني المتتالي
      //   يُنظّف ذاكرةَ نسخة واتساب ويب (فسادُها يُعلّق الإقلاعَ للأبد ولا يُصلحه تكرار)،
      //   والثالثُ يُعيد ضبطَ الجلسة تلقائيّاً (كزرّ «إعادة ضبط الجلسة» نفسِه) ويُشعر
      //   مدراءَ الوكيل أنّ رمزَ QR بانتظار المسح — مرّةً كلَّ ٢٤ ساعةً حدّاً أقصى.
      st.state = "error";
      st.retries = 0;
      st.exhaustions += 1;
      st.cooldownUntil = Date.now() + COOLDOWN_MS;
      if (st.exhaustions === 2) {
        wipeWebCache();
        st.lastError = "تعذّر الاتصال مجدّداً — نُظّفت ذاكرةُ نسخة واتساب ويب وتُعاد المحاولة خلال ١٠ دقائق (شفاءٌ ذاتيّ)";
      } else if (st.exhaustions >= 3 && (st.lastAutoResetAt == null || Date.now() - st.lastAutoResetAt > 24 * 3600_000)) {
        st.lastAutoResetAt = Date.now();
        st.exhaustions = 0;
        st.lastError = "أُعيد ضبطُ الجلسة تلقائيّاً بعد تعطّلٍ متكرّر — رمزُ QR سيظهر خلال دقائق، يُرجى مسحُه";
        publish(officeId);
        void autoResetBrokenSession(officeId);
        return;
      } else {
        st.lastError = "تعذّر إكمال اتصال الواتساب بعد عدّة محاولات — تُستأنف تلقائياً خلال ١٠ دقائق";
      }
      publish(officeId);
    }
  }, STARTUP_TIMEOUT_MS);
  return s.state;
}

// المكاتب التي تملك هذه الحاسبة جلسة واتسابها على القرص — هي وحدها التي تستضيفها (مالكة الجلسة).
// (الجلسة تُنشأ محلياً عند مسح QR على هذه الحاسبة، فلا تستضيف حاسبةٌ مكتباً لا تملك جلسته.)
function localOfficeIds(): number[] {
  try {
    if (!fs.existsSync(SESSION_DIR)) return [];
    const ids: number[] = [];
    for (const name of fs.readdirSync(SESSION_DIR)) {
      const m = /^session-office-(\d+)$/.exec(name);
      if (m) ids.push(Number(m[1]));
    }
    return ids;
  } catch { return []; }
}
export function hostsOfficeLocally(officeId: number): boolean {
  try { return fs.existsSync(path.join(SESSION_DIR, `session-office-${officeId}`)); } catch { return false; }
}

// عزل صارم: التخلّي محلياً عن جلسة مكتبٍ ليس لهذه الحاسبة (نُسِخت خطأً) — يهدم العميل
// ويحذف الملفات المحلية، ودون logout (كي لا يُفصَل واتساب المكتب على حاسبته الحقيقية).
// ويحرّر الملكية في القاعدة فقط إن كانت مسجّلة لهذه الحاسبة (فيعكس العرض «غير متصل»).
async function abandonStrayOffice(officeId: number, mid: string | null) {
  const st = store(officeId);
  if (st.client) { try { await Promise.resolve(st.client.destroy()).catch(() => {}); } catch { /* تجاهل */ } st.client = null; }
  st.state = "disconnected"; st.qr = null; st.qrAt = null; st.cooldownUntil = null; st.lastError = null; st.startedAt = null;
  deleteSessionDir(officeId);
  // انشر «غير متصل» وحرّر الملكية — فقط إن كانت مسجّلة لهذه الحاسبة أو بلا مالك
  // (لا نلمس مكتباً تستضيفه حاسبة أخرى حيّة)
  await prisma.waSession.updateMany({
    where: { towerId: officeId, OR: [{ hostMachineId: mid }, { hostMachineId: null }] },
    data: { state: "disconnected", hostMachineId: null, qr: null },
  }).catch(() => {});
}

// مستطلِع الاتصال: كل حاسبة تُبقي جلسة مكتبها متصلة — بمهلة 60ث بين المحاولات.
// ═════ 🔴 حالةُ الجلسة تكذب بعد إطفاء العامل (بلاغ محمد 2026-08-14) ═════
// `wa_sessions.state` يبقى `ready` مكتوباً في القاعدة بعد إطفاء العامل أو إعادة تشغيله —
// فالموقعُ يظنّ الجلسةَ جاهزةً ويُمرّر إليها الرسائل، ثمّ تفشل بـ«واتساب المكتب غير جاهز
// (الحالة: disconnected)». وهو عينُ الخطأ الذي رآه محمد عند إرسال ملخّصٍ لحظةَ نشرة.
// ⇒ عند إقلاع العامل: كلُّ جلسةٍ **مسجَّلةٍ باسم هذه الحاسبة** تُصفَّر إلى `disconnected`
//   فوراً — فالعميلُ لم يبدأ بعد. وحين يبلغ `ready` فعلاً يُعيد نشرَها (السطر ٤٤).
// 🔒 ولا تُلمَس جلسةُ حاسبةٍ أخرى حيّة: الشرطُ `hostMachineId = MACHINE_ID` حصراً.
async function resetOwnSessionsOnBoot(): Promise<void> {
  const mid = process.env.MACHINE_ID || null;
  if (!mid) return; // بلا هويّةٍ لا نُصفّر شيئاً — الصمتُ أسلمُ من لمسِ جلسةِ غيرنا
  const r = await prisma.waSession.updateMany({
    where: { hostMachineId: mid, state: { in: ["ready", "qr", "authenticated", "starting"] } },
    data: { state: "disconnected", qr: null, error: "العاملُ أُعيد تشغيلُه — بانتظار اتّصال الجلسة" },
  }).catch(() => null);
  if (r?.count) console.log(`[whatsapp] 🔄 صُفِّرت حالةُ ${r.count} جلسةٍ لهذه الحاسبة عند الإقلاع (كانت تُظهر «جاهزة» والعميلُ لم يبدأ)`);
}

export function startWaRequestPoller() {
  const gg = globalThis as unknown as { __waPollerStarted?: boolean };
  if (gg.__waPollerStarted) return;
  gg.__waPollerStarted = true;
  void resetOwnSessionsOnBoot(); // قبل أوّل دورة — فلا نافذةَ تكذب فيها الحالة
  setInterval(async () => {
    try {
      const mid = process.env.MACHINE_ID || null;
      const ids = localOfficeIds();

      // ===== عزل واتساب صارم: هذه الحاسبة مربوطة بمكتب (towerId) ⇒ تستضيف جلسته فقط =====
      // أي جلسة مكتبٍ آخر على قرصها (نُسِخت خطأً/تسرّبت) تُحذف فوراً ولا تُستضاف أبداً —
      // فلا تحجز حاسبةٌ مكتباً ليس لها حتى لو وُجدت ملفاته. (يُلغي «القائد يستضيف الكل».)
      const { getWorkerTowerId } = await import("@/lib/hybridAgent");
      const boundTower = getWorkerTowerId();
      if (boundTower != null) {
        // تخلَّ عن أي مكتب آخر — سواء له ملفات على القرص أو عميل حيّ في الذاكرة (حالة QR)
        const strays = new Set<number>([...ids, ...offices().keys()]);
        strays.delete(boundTower);
        for (const id of strays) {
          const st = store(id);
          if (hostsOfficeLocally(id) || st.client) {
            await abandonStrayOffice(id, mid);
            console.log(`[whatsapp] 🧹 عزل صارم: تُرك مكتب ${id} — هذه الحاسبة مربوطة بمكتب ${boundTower} فقط`);
          }
        }
        // استضِف مكتبي دائماً: يستأنف من ملفاته إن وُجدت، وإلا يُظهر QR للربط الأول
        // (مكتب بلا جلسة). وأتجاهل أي ملكية قديمة عالقة لحاسبة أخرى — أثبّتها لي عند ready.
        const st = store(boundTower);
        const alive = st.client && (st.state === "ready" || (st.state === "qr" && !qrStuck(st)) || st.state === "authenticated" || st.state === "starting");
        const recentlyTried = st.startedAt != null && Date.now() - st.startedAt < 60_000;
        if (!alive && !recentlyTried) void startWhatsApp(boundTower);
        // نبضة صحّة لعميل الواتساب نفسه: كانت الحالة تُكتب مرّة عند ready ولا تُراجَع،
        // فتبقى «متصل» بينما العميل ميت — وهذا ما رآه محمد في الشهداء (٣ آب): الحاسبة
        // تنبض والحالة ready والإرسال يفشل بـ«انتهت المهلة». الآن الطابع الزمني يتجدّد
        // ما دام العميل جاهزاً فعلاً، والموقع يعتبر ready قديمةً = غير متصل.
        // عالٍ (د): الختمُ يُجدَّد فقط إن **أجاب العميلُ نفسُه** (مسبارٌ كلَّ دقيقة) —
        // لا بفحص المتغيّر المخزون. عميلٌ ميّتٌ يُهدَم بعد فشلَين فيُعاد وصلُه تلقائيّاً.
        if (await ensureReadyIsReal(boundTower)) {
          await prisma.waSession.updateMany({
            where: { towerId: boundTower },
            data: { state: "ready", hostMachineId: mid ?? undefined },
          }).catch(() => {});
        }
        return;
      }

      // ===== غير مربوطة (توافق قديم): الملكية الحصرية — جلسةٌ مالكتها حاسبة أخرى تُحذف محلياً =====
      if (ids.length === 0) return;
      const owners = new Map<number, string | null>();
      if (mid) {
        try {
          const rows = await prisma.waSession.findMany({ where: { towerId: { in: ids } }, select: { towerId: true, hostMachineId: true } });
          for (const r of rows) owners.set(r.towerId, r.hostMachineId ?? null);
        } catch { /* تعذّرت القراءة — نكمل بلا فحص الملكية هذه الدورة */ }
      }
      for (const id of ids) {
        const st = store(id);
        const owner = owners.get(id) ?? null;
        if (mid && owner && owner !== mid) {
          const aliveHere = st.client && (st.state === "ready" || st.state === "authenticated");
          if (!aliveHere) {
            deleteSessionDir(id);
            console.log(`[whatsapp] 🧹 حُذفت نسخة جلسة قديمة لمكتب ${id} — الجلسة مملوكة لحاسبة أخرى`);
            continue;
          }
        }
        // عالٍ (د): قبل عدِّ «ready» حياةً يُسأل العميلُ نفسُه — الميّتُ يُهدَم داخل
        // المسبار فيصير disconnected ويُلتقَط بالسطر التالي في نفس الدورة
        if (st.state === "ready" && st.client) {
          // متوسّط(١٩) · كانت غيرُ المربوطة لا تجدّد ختمَ ready إطلاقاً ⇒ الموقعُ يعرض
          // مكاتبَها «غير متصل» دائماً بعد ٥ دقائق (حارسُ الطزاجة). الآن تجدّده — **بعد
          // مسبارٍ صادقٍ** (عالٍ د) ولمِلْكها فقط (hostMachineId = هذه الحاسبة) فلا تدهس
          // ملكيّةَ حاسبةٍ أخرى.
          if (await ensureReadyIsReal(id) && mid) {
            await prisma.waSession.updateMany({
              where: { towerId: id, hostMachineId: mid },
              data: { state: "ready" },
            }).catch(() => {});
          }
        }
        const alive = st.client && (st.state === "ready" || (st.state === "qr" && !qrStuck(st)) || st.state === "authenticated" || st.state === "starting");
        const recentlyTried = st.startedAt != null && Date.now() - st.startedAt < 60_000;
        if (!alive && !recentlyTried) void startWhatsApp(id); // أعد وصل جلسة هذه الحاسبة
      }
    } catch { /* تجاهل */ }
  }, 8000);
}

export function whatsappStatus(officeId: number): { state: WaState; qr: string | null; error: string | null } {
  const s = store(officeId);
  return { state: s.state, qr: s.qr, error: s.lastError };
}

// حذف مجلد جلسة مكتب محفوظة (LocalAuth) — يمنع بقاء تسجيل دخول قديم عالق
function deleteSessionDir(officeId: number) {
  try {
    const dir = path.join(SESSION_DIR, `session-office-${officeId}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* أفضل جهد — قد يبقى قفل مؤقت على ويندوز */ }
}

// 🩹 تنظيفُ ذاكرة نسخة واتساب ويب (.wwebjs_cache) — لا تمسّ الربطَ ولا تحتاج مسحَ QR.
// المكتبةُ تحفظ صفحةَ واتساب ويب بنسخها هنا؛ نسخةٌ فاسدةٌ/متعارضةٌ تُعلّق الإقلاعَ على
// «جاري البدء» إلى الأبد، وإعادةُ المحاولة بنفس الملفّات عبثٌ — هذا كان قفصَ مكتب المهندس.
function wipeWebCache() {
  try {
    const dir = path.join(process.cwd(), ".wwebjs_cache");
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    console.log("[whatsapp] 🩹 نُظّفت ذاكرةُ نسخة واتساب ويب (.wwebjs_cache)");
  } catch { /* أفضل جهد */ }
}

// 🩹 الدرجةُ الأخيرة من سُلَّم الشفاء: إعادةُ ضبط الجلسة تلقائيّاً (ما كان يفعله زرُّ
// «إعادة ضبط الجلسة» يدويّاً) + إشعارُ مدراء الوكيل أنّ الرمزَ بانتظار المسح — فلا يبقى
// مكتبٌ ميّتاً أيّاماً حتى يلاحظ أحد. لا logout (الجلسةُ معطوبةٌ أصلاً ولا عميلَ حيّ).
async function autoResetBrokenSession(officeId: number) {
  const s = store(officeId);
  if (s.client) { try { await Promise.resolve(s.client.destroy()).catch(() => {}); } catch { /* تجاهل */ } s.client = null; }
  deleteSessionDir(officeId);
  wipeWebCache();
  s.state = "disconnected"; s.qr = null; s.qrAt = null; s.startedAt = null; s.cooldownUntil = null;
  publish(officeId);
  console.log(`[whatsapp] 🩹 مكتب ${officeId}: أُعيد ضبطُ الجلسة تلقائيّاً بعد تعطّلٍ متكرّر — بانتظار مسح QR`);
  // إشعارُ مدراء الوكيل (إشعارٌ داخليٌّ + دفعٌ للهاتف) — أفضلُ جهدٍ لا يعطّل الشفاء
  try {
    const office = await prisma.tower.findUnique({ where: { id: officeId }, select: { name: true, agentId: true } });
    if (office?.agentId != null) {
      const admins = await prisma.user.findMany({
        where: { agentId: office.agentId, isAdmin: true, isDeleted: false, isActive: true },
        select: { id: true },
      });
      const title = "واتساب المكتب يحتاج مسحَ QR";
      const body = `⚠️ واتساب مكتب «${office.name ?? officeId}» تعطّل مراراً فأُعيد ضبطُ جلسته تلقائيّاً — افتح صفحة المكاتب وامسح رمزَ QR لإعادة ربطه`;
      for (const a of admins) {
        await prisma.notification.create({ data: { userId: a.id, agentId: office.agentId, towerId: officeId, title, body, type: "wa" } }).catch(() => {});
        void import("@/lib/push").then((m) => m.sendPushToUser(a.id, { title, body, tag: `wa-reset-${officeId}` })).catch(() => {});
      }
    }
  } catch { /* الإشعارُ مكسبٌ لا شرط */ }
  void startWhatsApp(officeId); // إقلاعٌ نظيفٌ من الصفر — الرمزُ الجديد يظهر خلال دقائق
}

// فصل واتساب مكتب: يُلغي الربط على واتساب، يهدم المتصفّح، ويحذف الجلسة المحفوظة
// فوراً (حتى لا تبقى جلسة قديمة تُسبّب عُلوق "جاري البدء" لاحقاً).
export async function logoutWhatsApp(officeId: number): Promise<void> {
  const s = store(officeId);
  const withTimeout = <T>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise((res) => setTimeout(res, ms))]);
  if (s.client) {
    // logout يُلغي الربط من خوادم واتساب؛ قد يعلّق فنحدّه بمهلة
    try { await withTimeout(Promise.resolve(s.client.logout()), 8000); } catch { /* ignore */ }
    try { await withTimeout(Promise.resolve(s.client.destroy()), 8000); } catch { /* ignore */ }
  }
  s.client = null;
  s.state = "disconnected";
  s.qr = null;
  s.lastError = null;
  s.startedAt = null;
  deleteSessionDir(officeId); // امسح كل أثر للجلسة فور الفصل
  // الفصل يُلغي ملكية الجلسة — الربط القادم يحدّد المالكة الجديدة (أول من يصل ready)
  // متوسّط(٢٩) · كان فشلُ التحرير مبتلَعاً: تبقى ملكيّةُ الجلسة (والطباعةُ التابعةُ لها)
  // لحاسبةٍ فُكّ ربطُها. يُعاد حتى ٣ مرّاتٍ ويُصرَخ إن فشلت كلُّها.
  {
    let freed = false;
    for (let i = 0; i < 3 && !freed; i++) {
      try { await prisma.waSession.update({ where: { towerId: officeId }, data: { hostMachineId: null } }); freed = true; }
      catch { await new Promise((r) => setTimeout(r, 1500)); }
    }
    if (!freed) console.error(`[whatsapp] 🔴 تعذّر تحريرُ ملكيّة جلسة مكتب ${officeId} — الطباعةُ قد تبقى منسوبةً لحاسبةٍ مفكوكة`);
  }
  publish(officeId); // انشر "disconnected" للسحابة فوراً
}

// إغلاق نظيف لكل جلسات الواتساب على هذه الحاسبة قبل إطفاء العملية: destroy فقط (لا logout)
// كي يُفرِغ كروميوم حالة الجلسة إلى القرص. الإطفاء المفاجئ دون هذا يترك الجلسة نصف-مكتوبة
// فتُرفَض عند الإقلاع التالي (تسجيل خروج وطلب QR). يُستدعى من معالج إيقاف العامل.
export async function destroyAllWhatsApp(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const s of offices().values()) {
    if (s.client) {
      try { tasks.push(Promise.resolve(s.client.destroy()).catch(() => {})); } catch { /* تجاهل */ }
      s.client = null;
    }
  }
  // حدّ زمني كي لا يعلّق الإطفاء طويلاً (مهلة ويندوز للإغلاق محدودة)
  await Promise.race([Promise.allSettled(tasks), new Promise((r) => setTimeout(r, 6000))]);
}

// حالة واتساب المكاتب كما نشرها الوكيل في السحابة (Neon) — تقرأها كل مسارات الموقع.
// مهمّة لأن الموقع (Vercel) لا يملك عميل واتساب في ذاكرته؛ الحالة الحقيقية في القاعدة.
// «متصل» صادق فقط إذا كانت الحاسبة المُستضيفة لجلسة المكتب تُرسل نبضة الآن — وإلا فهي
// حالة مجمّدة (مستضيفها مُطفأ) ⇒ «غير متصل». يمنع ظهور مكتبٍ «متصلاً» بعد إطفاء حاسبته.
export async function readOfficeStates(officeIds: number[]): Promise<Record<number, WaState>> {
  const out: Record<number, WaState> = {};
  for (const id of officeIds) out[id] = "disconnected";
  if (officeIds.length === 0) return out;
  // الحواسيب المستضيفة المتصلة الآن (معتمَدة، غير محظورة، نبضة خلال 60ث)
  const onlineWorkers = await prisma.hybridWorker.findMany({
    where: { approved: true, blocked: false, lastSeen: { gte: new Date(Date.now() - 60_000) } },
    select: { machineId: true },
  });
  if (onlineWorkers.length === 0) return out; // لا حاسبة نشطة ⇒ لا اتصال واتساب فعلي
  const online = new Set(onlineWorkers.map((w) => w.machineId));
  const rows = await prisma.waSession.findMany({
    where: { towerId: { in: officeIds } },
    select: { towerId: true, state: true, hostMachineId: true, updatedAt: true },
  });
  // «ready» لا تُصدَّق إن لم تتجدّد خلال ٥ دقائق: العامل يجدّدها كل دورة ما دام عميل
  // الواتساب جاهزاً فعلاً — فحالةٌ قديمة تعني عميلاً ميتاً وإن كانت الحاسبة تنبض.
  const FRESH_MS = 5 * 60 * 1000;
  for (const r of rows) {
    // «ready» صادقة فقط إذا كانت حاسبتها المستضيفة (hostMachineId) متصلة الآن؛ وإلا مُجمّدة
    const stale = r.updatedAt == null || Date.now() - r.updatedAt.getTime() > FRESH_MS;
    if (r.state === "ready" && (!r.hostMachineId || !online.has(r.hostMachineId) || stale)) {
      out[r.towerId] = "disconnected";
    } else {
      out[r.towerId] = (r.state as WaState) ?? "disconnected";
    }
  }
  return out;
}

// تحويل رقم عراقي إلى معرّف واتساب
export function toWaId(phoneRaw: string): string | null {
  let p = (phoneRaw || "").replace(/[^\d+]/g, "");
  if (!p) return null;
  p = p.replace(/^\+/, "").replace(/^00/, "");
  if (p.startsWith("0")) p = "964" + p.slice(1);
  else if (p.length === 10 && p.startsWith("7")) p = "964" + p;
  if (p.length < 11) return null;
  return `${p}@c.us`;
}

/** `imageError`: الرسالةُ وصلت **بلا صورة** وهذا سببُه — يُوثَّق في سجلّ الرسائل للتشخيص.
 *  و`withImage`: وصلت بصورتها (يُفيد في تأكيد أنّ الميزةَ تعمل حين يُسأل عنها). */
export type SendResult = { ok: boolean; error?: string; imageError?: string; withImage?: boolean };

// ذاكرة مؤقتة للأرقام المؤكَّد أن لها واتساب (لتفادي إعادة الفحص على خوادم واتساب).
// نُخزّن النتائج الموجبة فقط؛ النتائج السالبة تُعاد فحصها دائماً حتى يظهر التنبيه
// ويختفي فوراً عندما يصبح للرقم واتساب.
const waRegisteredCache = new Map<string, number>();
const WA_POS_TTL = 6 * 60 * 60 * 1000; // 6 ساعات

// فحص هل الرقم مسجَّل في واتساب عبر جلسة واتساب المكتب.
// يُرجِع true (له واتساب) أو false (لا يملك) أو null إذا تعذّر الفحص
// (واتساب المكتب غير متصل، أو لا مكتب، أو الرقم غير صالح).
export async function hasWhatsApp(officeId: number | null | undefined, phone: string): Promise<boolean | null> {
  if (officeId == null) return null;
  const client = ready(officeId);
  if (!client) return null;
  const waId = toWaId(phone);
  if (!waId) return null;
  const digits = waId.replace(/@c\.us$/, "");
  const cached = waRegisteredCache.get(digits);
  if (cached && Date.now() - cached < WA_POS_TTL) return true;
  try {
    const id = await client.getNumberId(digits);
    if (id) { waRegisteredCache.set(digits, Date.now()); return true; }
    return false;
  } catch {
    return null;
  }
}

// ===== واجهة المحادثة (واتساب ويب لكل مكتب) =====
export type WaChat = { id: string; name: string; unread: number; timestamp: number; last: string; isGroup: boolean };
export type WaMessage = { id: string; body: string; fromMe: boolean; timestamp: number; type: string; hasMedia?: boolean };
export type WaMedia = { data?: string; mimetype?: string; filename?: string; filesize?: number; error?: string };

function ready(officeId: number): WAClient | null {
  const s = store(officeId);
  return s.state === "ready" && s.client ? s.client : null;
}

// صفحة المتصفّح للعميل (للقراءة المباشرة من Store عند فشل دوال المكتبة).
// نمرّر تعبير IIFE نصّياً (page.evaluate يقيّم النص ويُرجِع نتيجة وعده) — تفادياً
// لمشاكل تسلسل الدوال مع tsx وتمرير الوسائط.
function pupEval<T>(client: WAClient, expr: string): Promise<T> {
  const p = (client as unknown as { pupPage?: { evaluate: (e: string) => Promise<unknown> } }).pupPage;
  if (!p) return Promise.resolve([] as unknown as T);
  return p.evaluate(expr) as Promise<T>;
}

// قائمة محادثات مكتب (الأحدث أولاً).
// نقرأ من Store مباشرةً بحماية بدل client.getChats() لأن getChatModel في المكتبة
// يلمس وحدات داخلية تغيّرت في واتساب ويب فيرمي خطأً مُصغّراً ("r").
export async function getOfficeChats(officeId: number, limit = 40): Promise<WaChat[]> {
  const client = ready(officeId);
  if (!client) return [];
  const lim = Math.max(1, Math.min(200, Math.floor(limit)));
  const expr = `(async () => {
    const out = [];
    const C = window.require('WAWebCollections').Chat;
    const arr = C.getModelsArray ? C.getModelsArray() : (C._models || C.models || []);
    for (const c of arr) {
      try {
        const id = (c.id && c.id._serialized) ? c.id._serialized : ((c.id && c.id.user) || '');
        if (!id) continue;
        const isGroup = !!(c.id && c.id.server === 'g.us') || !!c.isGroup;
        let name = '';
        try { name = c.formattedTitle || c.name || ''; } catch(e) {}
        if (!name) { try { name = (c.contact && (c.contact.formattedName || c.contact.pushname || c.contact.name)) || ''; } catch(e) {} }
        if (!name && c.id && c.id.user) name = c.id.user;
        let timestamp = 0; try { timestamp = c.t || 0; } catch(e) {}
        let unread = 0; try { unread = c.unreadCount || 0; } catch(e) {}
        let last = '';
        try {
          const mlabel = (t) => t==='image'?'📷 صورة':t==='video'?'🎥 فيديو':(t==='ptt'||t==='audio')?'🎤 رسالة صوتية':t==='document'?'📄 ملف':t==='sticker'?'🌟 ملصق':t==='location'?'📍 موقع':(t==='vcard'||t==='multi_vcard')?'👤 جهة اتصال':'📎 مرفق';
          const ms = c.msgs && (c.msgs.getModelsArray ? c.msgs.getModelsArray() : c.msgs.models);
          const lm = (ms && ms.length) ? ms[ms.length - 1] : null;
          if (lm) last = lm.body || ((lm.type && lm.type !== 'chat') ? mlabel(lm.type) : '');
        } catch(e) {}
        out.push({ id, name, unread, timestamp, last, isGroup });
      } catch(e) {}
    }
    out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return out.slice(0, ${lim});
  })()`;
  try { return (await pupEval<WaChat[]>(client, expr)) ?? []; } catch { return []; }
}

// رسائل محادثة محدّدة — نقرأ رسائل المحادثة المحمَّلة من Store مباشرةً بحماية.
export async function getOfficeMessages(officeId: number, chatId: string, limit = 40): Promise<WaMessage[]> {
  const client = ready(officeId);
  if (!client) return [];
  const lim = Math.max(1, Math.min(200, Math.floor(limit)));
  const cid = JSON.stringify(String(chatId)); // اقتباس آمن للمعرّف داخل النص
  const expr = `(async () => {
    const C = window.require('WAWebCollections').Chat;
    let c = null;
    try { c = C.get ? C.get(${cid}) : null; } catch(e) {}
    if (!c) { const arr = C.getModelsArray ? C.getModelsArray() : (C._models || C.models || []); c = arr.find(x => x.id && x.id._serialized === ${cid}); }
    if (!c) return [];
    // علّم المحادثة كمقروءة عند فتحها (يُزيل عدّاد غير المقروء)
    try { if (window.WWebJS && window.WWebJS.sendSeen) await window.WWebJS.sendSeen(${cid}); } catch(e) {}
    // حمّل رسائل أقدم من الخادم حتى نبلغ الحد (الوحدة WAWebChatLoadMessages غير مكسورة)
    try {
      const loader = window.require('WAWebChatLoadMessages');
      let guard = 0;
      const count = () => { try { return c.msgs.getModelsArray().length; } catch(e) { return 0; } };
      while (loader && loader.loadEarlierMsgs && count() < ${lim} && guard < 12) {
        const loaded = await loader.loadEarlierMsgs({ chat: c });
        guard++;
        if (!loaded || !loaded.length) break;
      }
    } catch(e) {}
    let ms = [];
    try { ms = (c.msgs && (c.msgs.getModelsArray ? c.msgs.getModelsArray() : c.msgs.models)) || []; } catch(e) {}
    const mlabel = (t) => t==='image'?'📷 صورة':t==='video'?'🎥 فيديو':(t==='ptt'||t==='audio')?'🎤 رسالة صوتية':t==='document'?'📄 ملف':t==='sticker'?'🌟 ملصق':t==='location'?'📍 موقع':(t==='vcard'||t==='multi_vcard')?'👤 جهة اتصال':'📎 مرفق';
    return ms.slice(-${lim}).map((m) => {
      let id = ''; try { id = (m.id && m.id._serialized) || ''; } catch(e) {}
      let body = ''; try { body = m.body || ''; } catch(e) {}
      let fromMe = false; try { fromMe = !!(m.id && m.id.fromMe); } catch(e) {}
      let ts = 0; try { ts = m.t || 0; } catch(e) {}
      let type = 'chat'; try { type = m.type || 'chat'; } catch(e) {}
      let hasMedia = false; try { hasMedia = !!(m.mediaData && m.mediaData.type) || ['image','video','ptt','audio','document','sticker'].indexOf(type) >= 0; } catch(e) {}
      return { id, body: body || (type !== 'chat' ? mlabel(type) : ''), fromMe, timestamp: ts, type, hasMedia };
    });
  })()`;
  try { return (await pupEval<WaMessage[]>(client, expr)) ?? []; } catch { return []; }
}

// تنزيل وسائط رسالة محدّدة (صورة/فيديو/صوت/ملف) وإرجاعها base64.
// نُكرّر منطق المكتبة (WAWebDownloadManager) — وهو مسار غير مكسور.
export async function downloadOfficeMedia(officeId: number, msgId: string): Promise<WaMedia | null> {
  const client = ready(officeId);
  if (!client) return null;
  const mid = JSON.stringify(String(msgId));
  const expr = `(async () => {
    const Col = window.require('WAWebCollections');
    let msg = Col.Msg.get(${mid});
    if (!msg) { try { const r = await Col.Msg.getMessagesById([${mid}]); msg = r && r.messages && r.messages[0]; } catch(e){} }
    if (!msg || !msg.mediaData) return { error: 'no-media' };
    if (msg.size && msg.size > 8388608) return { error: 'too-large' };
    if (msg.mediaData.mediaStage === 'REUPLOADING') return { error: 'expired' };
    try {
      if (msg.mediaData.mediaStage != 'RESOLVED') {
        await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
      }
      const stage = msg.mediaData.mediaStage || '';
      if (stage.indexOf('ERROR') >= 0 || stage === 'FETCHING') return { error: 'unavailable' };
      const dec = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
        directPath: msg.directPath, encFilehash: msg.encFilehash, filehash: msg.filehash,
        mediaKey: msg.mediaKey, mediaKeyTimestamp: msg.mediaKeyTimestamp, type: msg.type,
        signal: new AbortController().signal,
        downloadQpl: { addAnnotations: function(){ return this; }, addPoint: function(){ return this; } },
      });
      const data = await window.WWebJS.arrayBufferToBase64Async(dec);
      return { data, mimetype: msg.mimetype || 'application/octet-stream', filename: msg.filename || '', filesize: msg.size || 0 };
    } catch(e) { return { error: (e && e.message) || 'failed' }; }
  })()`;
  try { return (await pupEval<WaMedia>(client, expr)) ?? null; } catch { return null; }
}

// إرسال رد في محادثة
export async function sendOfficeChat(officeId: number, chatId: string, text: string): Promise<SendResult> {
  const client = ready(officeId);
  if (!client) return { ok: false, error: "واتساب المكتب غير متصل" };
  try {
    await client.sendMessage(chatId, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// إرسال محلّي مباشر من عميل واتساب هذه الحاسبة (بلا تمرير) — تستعمله مالكة الجلسة والمُرحِّل.
// ═════ 🏷️ بصمةُ نسخة حاسبة المكتب — تُرافق نتيجةَ كلّ ترحيلِ إرسال ═════
// الواتسابُ يُرسَل من حاسبة المكتب لا من السحابة، فإن كانت تشغّل نسخةً أقدمَ من بناء
// الصورة (٢٠٢٦-٠٨-١٣) فهي تتجاهل `p.image` وترسل النصَّ وحدَه **بصمتٍ تامّ** — وهو
// أرجحُ تفسيرٍ لبلاغ «الصورةُ لا تصل». وغيابُ الحقل نفسِه في النتيجة **دليلُ قِدَم**.
let __buildId: string | null = null;
function workerBuild(): string {
  if (__buildId) return __buildId;
  const env = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (env) return (__buildId = env.slice(0, 7));
  try { __buildId = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim().slice(0, 12); }
  catch { __buildId = "unknown"; }
  return __buildId;
}

async function sendWhatsAppLocal(officeId: number, phone: string, text: string, image?: string | null): Promise<SendResult> {
  const s = store(officeId);
  if (s.state !== "ready" || !s.client) return { ok: false, error: "واتساب المكتب غير متصل — اربطه من إدارة المكاتب" };
  const waId = toWaId(phone);
  if (!waId) return { ok: false, error: `رقم غير صالح: ${phone}` };
  const client = s.client;
  try {
    // ═════ البند ٣ · صورةٌ مع الرسالة (طلبُ محمد 2026-08-13) ═════
    // «أريد إمكانيةَ إضافة صورةٍ إلى قوالب رسائل الواتساب بحيث تصل مع الرسالة ولأيّ
    //  قالبٍ أختاره». والصورةُ تُرسَل **مع النصّ تعليقاً واحداً** لا رسالتَين — فرسالتان
    //  تُضاعفان ما يراه المشتركُ وما يُحسَب على الرقم.
    // 🔑 وعند فشلِ الصورة **يُرسَل النصُّ وحدَه**: رسالةٌ بلا صورةٍ خيرٌ من لا رسالة.
    // ═════ 🖼️ سببُ سقوط الصورة يُوثَّق في **سجلّ الرسائل** لا في نافذة الحاسبة وحدَها ═════
    // (بلاغ محمد 2026-08-14: «وصلت الرسالةُ بلا صورة» — وكان السببُ محبوساً في `console`
    //  على حاسبة المكتب، فتعذّر تشخيصُه عن بُعد. الآن يعود مع النتيجة فيُكتب في `messages`.)
    let imageNote: string | null = null;
    if (image) {
      try {
        const { MessageMedia } = await import("whatsapp-web.js");
        const m = /^data:([^;]+);base64,(.+)$/.exec(image);
        if (m) {
          const media = new MessageMedia(m[1], m[2]);
          await client.sendMessage(waId, media, { caption: text });
          return { ok: true, withImage: true };
        }
        // لا يطابق صيغةَ data URI ⇒ كان يسقط **صامتاً تماماً** قبل اليوم
        imageNote = `صيغةُ الصورة غير صالحة (لا تبدأ بـdata:…;base64) — طولُها ${image.length}`;
      } catch (e) {
        imageNote = `تعذّر إرسال الصورة: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
      }
      if (imageNote) console.error("[whatsapp] يُرسَل النصُّ وحدَه —", imageNote);
    }
    await client.sendMessage(waId, text);
    // «أُرسلت بلا صورة» ليست فشلاً — الرسالةُ وصلت، والسببُ يُحفَظ للتشخيص
    return imageNote ? { ok: true, imageError: imageNote } : { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ===== «No LID for user» — رسائل تضيع بلا محاولة ثانية (تشخيص 2026-08-05) =====
    // واتساب انتقل إلى عناوين LID، فالمعرّف القديم (964…@c.us) لم يعد يكفي وحده:
    // رقمٌ لم تخاطبه هذه الجلسة من قبل ليس في مخزنها، فترمي المكتبة هذا الخطأ
    // وتُسجَّل الرسالة FAILED وتُنسى. القياس على القاعدة: ~٢٢٠ رسالة ضاعت هكذا
    // منذ 31 تموز — منها رسالة تفعيل خالد في الرسالة اليوم ١٥:٤٩.
    // العلاج: نسأل خادم واتساب عن معرّف الرقم (getNumberId — وهي نفسها المستعملة
    // في فحص «هل له واتساب») ثم نُعيد الإرسال إلى المعرّف الذي أعاده. وإن لم يُعِد
    // شيئاً فالرقم فعلاً بلا واتساب، وهذه حقيقة تُقال لا خطأ تقني مبهم.
    if (/lid/i.test(msg)) {
      const digits = waId.replace(/@c\.us$/, "");
      try {
        const id = await client.getNumberId(digits);
        if (!id?._serialized) return { ok: false, error: "الرقم ليس له واتساب" };
        await client.sendMessage(id._serialized, text);
        return { ok: true };
      } catch (e2) {
        return { ok: false, error: `تعذّر حلّ معرّف الرقم: ${e2 instanceof Error ? e2.message : String(e2)}` };
      }
    }
    return { ok: false, error: msg };
  }
}

// إرسال رسالة نصية من واتساب مكتب محدّد. إن كانت جلسة هذا المكتب على حاسبةٍ أخرى (مالكة الجلسة)
// نُمرّر الإرسال إليها عبر المُرحِّل — فيعمل الإرسال المجدول/السحابي لكل مكتب من حاسبته.
export async function sendWhatsApp(officeId: number | null | undefined, phone: string, text: string, image?: string | null): Promise<SendResult> {
  if (officeId == null) return { ok: false, error: "المشترك غير مربوط بمكتب" };
  const s = store(officeId);
  if (s.state === "ready" && s.client) return sendWhatsAppLocal(officeId, phone, text, image);
  // هذه الحاسبة مالكة الجلسة لكنها غير جاهزة الآن ⇒ لا تُمرّر لنفسها
  if (hostsOfficeLocally(officeId)) return { ok: false, error: "واتساب المكتب غير متصل — اربطه من إدارة المكاتب" };
  // ليست المالكة ⇒ مرّر الإرسال إلى حاسبة المكتب.
  // المهلة ٤٥ ثانية لا ١٥: القياس على مكتب الشدن (2026-08-10) أظهر إرسالاً يستغرق ١٢–١٤ ثانية
  // في الإرسال الجماعيّ، فكانت رسائلٌ **وصلت فعلاً** تُختَم "فاشلة" لمجرّد تجاوز المهلة.
  const r = await relayRequest(officeId, "sendMsg", { phone, text, image: image ?? null }, 45000);
  if (!r.ok) return { ok: false, error: r.error ?? "تعذّر الإرسال عبر حاسبة المكتب" };
  // 🖼️ نتيجةُ الصورة تعود من الحاسبة عبر `result` — فيُعرَف سببُ سقوطها من الموقع نفسِه
  const rr = (r.result ?? {}) as { imageError?: string; withImage?: boolean };
  return { ok: true, ...(rr.imageError ? { imageError: rr.imageError } : {}), ...(rr.withImage ? { withImage: true } : {}) };
}

// ===== مُرحِّل عمليات واتساب (الموقع ↔ الوكيل) =====
// الموقع لا يملك عميل واتساب؛ فيرسل الطلب عبر جدول wa_relays، ويُنفّذه الوكيل القائد.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// (على الموقع) أنشئ طلباً وانتظر نتيجته من الوكيل — مع مهلة.
export async function relayRequest(
  towerId: number,
  kind: "chats" | "messages" | "send" | "logout" | "media" | "sas" | "sendMsg",
  params: Record<string, unknown> = {},
  timeoutMs = 9000,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  // لا فائدة من الطلب إن لم يكن أي عاملٍ لوكيل هذا المكتب متصلاً (السحابة لا تعرف أي حاسبة تملك الجلسة)
  const tower = await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } });
  const online = await prisma.hybridWorker.findFirst({
    where: { approved: true, agentId: tower?.agentId ?? -1, lastSeen: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (!online) return { ok: false, error: "حاسبة مكتب هذا الوكيل غير مشغّلة حالياً" };

  const row = await prisma.waRelay.create({
    data: { towerId, kind, params: JSON.stringify(params) },
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(700);
    const r = await prisma.waRelay.findUnique({ where: { id: row.id } });
    if (r?.status === "done") return { ok: true, result: r.result ? JSON.parse(r.result) : null };
    if (r?.status === "error") return { ok: false, error: r.error ?? "فشل التنفيذ على الوكيل" };
  }
  // انتهت المهلة. إن كان الطلب **قيد التنفيذ** على حاسبة المكتب فلا نلمسه ولا ندّعي فشله
  // (كان يُختَم "error" فيُسجَّل فشلٌ لرسالةٍ وصلت فعلاً بعد ثانية). وإن لم يبدأ بعد نُلغِه.
  const cur = await prisma.waRelay.findUnique({ where: { id: row.id }, select: { status: true } }).catch(() => null);
  if (cur?.status === "running") {
    return { ok: false, error: "انتهت المهلة والتنفيذ جارٍ على حاسبة المكتب — قد تكون الرسالة قد وصلت" };
  }
  // 🧹 والصورةُ تُنزَع هنا أيضاً: الطلبُ **لن يُنفَّذ**، فلا معنى لبقاء ٤٠٠ كيلوبايتٍ
  //   في الصفّ خمسَ دقائقَ إلى أن يمسحه المنظِّف.
  await prisma.waRelay.update({ where: { id: row.id }, data: { status: "error", error: "timeout", params: scrubRelayImage(row.params) } }).catch(() => {});
  return { ok: false, error: "انتهت المهلة — تأكّد أن وكيل المكتب متصل" };
}

// (على الوكيل) تنفيذ عملية SAS محلياً — الحاسبة في العراق قرب خادم SAS فأسرع من Vercel.
async function runSasOp(towerId: number, op: string, p: { page?: number; count?: number }): Promise<unknown> {
  const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
  const { sasBaseUrl, sasLogin, sasFetchOnePage } = await import("@/lib/sas4");
  // أ-٢٣ · `…All` تُزامن كلَّ لوحات المكتب (ومكتبُ اللوحةِ الواحدةِ يمرّ بالمسار القديم حرفيّاً)
  if (op === "sync") return runOfficeSyncAll(towerId, { notify: false });
  const tower = await prisma.tower.findUnique({ where: { id: towerId }, select: { loginUrl: true, username: true, password: true } });
  if (!tower?.loginUrl || !tower.username || !tower.password) throw new Error("بيانات SAS ناقصة لهذا المكتب");
  const base = sasBaseUrl(tower.loginUrl);
  const token = await sasLogin(base, tower.username, tower.password);
  if (op === "token") return { token };
  if (op === "fetchPage") return sasFetchOnePage(base, token, p.page ?? 1, p.count ?? 10);
  throw new Error(`عملية SAS غير معروفة: ${op}`);
}

// (على الوكيل) نفّذ طلبات المُرحِّل المعلّقة لمكتب هذه الحاسبة فقط (مالكة جلسة واتساب/خادم SAS).
export function startWaRelayPoller() {
  const gg = globalThis as unknown as { __waRelayPollerStarted?: boolean };
  if (gg.__waRelayPollerStarted) return;
  gg.__waRelayPollerStarted = true;
  // دورةٌ واحدةٌ في كلّ لحظة: setInterval لا ينتظر الدورة السابقة، فكانت الدورات تتراكب
  // على الطلبات نفسها. (جزءٌ من إصلاح تكرار الرسائل — 2026-08-10)
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // واتساب: هذه الحاسبة تعالج مكاتبها (مالكة الجلسة على القرص).
      // SAS: القائد يعالجها لكل مكاتب وكيله (كما هو — لا تغيير على سلوك SAS).
      const localIds = localOfficeIds();
      const orConds: { towerId: { in: number[] }; kind: string | { in: string[] } }[] = [];
      if (localIds.length) orConds.push({ towerId: { in: localIds }, kind: { in: ["chats", "messages", "send", "media", "logout", "sendMsg"] } });
      const { isLeaderNow, getWorkerAgentId } = await import("@/lib/hybridAgent");
      if (isLeaderNow()) {
        const aid = getWorkerAgentId();
        if (aid != null) {
          const rows = await prisma.tower.findMany({ where: { agentId: aid, isDeleted: false }, select: { id: true } });
          if (rows.length) orConds.push({ towerId: { in: rows.map((t) => t.id) }, kind: "sas" });
        }
      }
      if (!orConds.length) return;
      const pend = await prisma.waRelay.findMany({
        where: { status: "pending", createdAt: { gte: new Date(Date.now() - 60_000) }, OR: orConds },
        orderBy: { id: "asc" },
        take: 5,
      });
      for (const relayRow of pend) {
        // ===== حَجزٌ ذرّيّ قبل التنفيذ (إصلاح تكرار الرسائل — 2026-08-10) =====
        // كان الصفّ يبقى "pending" طولَ مدّة التنفيذ، والدورة تعمل كلّ ثانيتين، فإن استغرق
        // الإرسال ١٢ ثانية (وهذا ما قِيس فعلاً في مكتب الشدن) التقطته دوراتٌ متعدّدة فوصلت
        // المشتركَ نُسَخٌ من الرسالة نفسها. الآن: من يقلبه إلى "running" أوّلاً ينفّذه وحده،
        // ومن يخسر السباق يتخطّاه. والصفوف المعلّقة أقدم من ٥ دقائق تُحذف بالتنظيف أدناه.
        const claimed = await prisma.waRelay.updateMany({
          where: { id: relayRow.id, status: "pending" },
          data: { status: "running" },
        });
        if (claimed.count !== 1) continue;
        // مزامنة SAS تأخذ **دقائق** لا ثواني. ومع راية busy أعلاه ستحبس الدورةَ فتتعطّل
        // رسائل الواتساب القصيرة خلفها (وهي في أثناء بثٍّ جماعيّ = مشتركون يُتخطَّون).
        // فنُنفّذها **مفصولةً** — وقد حُجزت ذرّيّاً أعلاه فلن تُنفَّذ مرّتين.
        if (relayRow.kind === "sas") {
          void (async () => {
            try {
              const sp = (relayRow.params ? JSON.parse(relayRow.params) : {}) as { op?: string; page?: number; count?: number };
              const result = await runSasOp(relayRow.towerId, sp.op ?? "", sp);
              await prisma.waRelay.update({ where: { id: relayRow.id }, data: { status: "done", result: JSON.stringify(result), params: scrubRelayImage(relayRow.params) } });
            } catch (e) {
              const detail = e instanceof Error ? (e.stack || `${e.name}: ${e.message}`) : String(e);
              console.error(`[wa-relay] فشل sas مكتب ${relayRow.towerId}:`, detail);
              await prisma.waRelay.update({ where: { id: relayRow.id }, data: { status: "error", error: detail.slice(0, 1500), params: scrubRelayImage(relayRow.params) } }).catch(() => {});
            }
          })();
          continue;
        }
        try {
          const p = (relayRow.params ? JSON.parse(relayRow.params) : {}) as { chatId?: string; text?: string; phone?: string; image?: string | null; limit?: number; msgId?: string; op?: string; page?: number; count?: number };
          // تأكّد أن واتساب المكتب جاهز فعلاً قبل عمليات الواتساب (لا يلزم لعمليات SAS)
          const st = store(relayRow.towerId);
          if ((relayRow.kind === "chats" || relayRow.kind === "messages" || relayRow.kind === "send" || relayRow.kind === "media" || relayRow.kind === "sendMsg") && st.state !== "ready") {
            throw new Error(`واتساب المكتب غير جاهز (الحالة: ${st.state})`);
          }
          let result: unknown = null;
          if (relayRow.kind === "chats") result = await getOfficeChats(relayRow.towerId, p.limit ?? 40);
          else if (relayRow.kind === "messages") result = await getOfficeMessages(relayRow.towerId, p.chatId ?? "", p.limit ?? 40);
          else if (relayRow.kind === "send") result = await sendOfficeChat(relayRow.towerId, p.chatId ?? "", p.text ?? "");
          // 🖼️ ونتيجةُ الصورة تُعاد إلى الموقع (لا تبقى في نافذة الحاسبة) فتُكتب في سجلّ الرسائل
          else if (relayRow.kind === "sendMsg") { const rr = await sendWhatsAppLocal(relayRow.towerId, p.phone ?? "", p.text ?? "", p.image ?? null); if (!rr.ok) throw new Error(rr.error ?? "فشل الإرسال"); result = { ok: true, build: workerBuild(), gotImage: !!p.image, ...(rr.imageError ? { imageError: rr.imageError } : {}), ...(rr.withImage ? { withImage: true } : {}) }; }
          else if (relayRow.kind === "media") result = await downloadOfficeMedia(relayRow.towerId, p.msgId ?? "");
          else if (relayRow.kind === "logout") { await logoutWhatsApp(relayRow.towerId); result = { ok: true }; }
          else if (relayRow.kind === "sas") result = await runSasOp(relayRow.towerId, p.op ?? "", p);
          // 🧹 **الصورةُ تُمسَح من صفّ الترحيل لحظةَ التنفيذ** (طلبُ محمد 2026-08-13):
          //   الصفُّ يحمل نسخةَ base64 كاملةً لكلّ رسالة، وكان يبقى **حتى تنظيفِ الخمس
          //   دقائق** — فآلافُ الرسائل تعني آلافَ النسخ تمرّ على القاعدة وتُغلي الفاتورة.
          //   والصورةُ بعد الإرسال **بلا فائدةٍ إطلاقاً**: أُرسلت، والأصلُ محفوظٌ في القالب.
          await prisma.waRelay.update({
            where: { id: relayRow.id },
            data: { status: "done", result: JSON.stringify(result), params: scrubRelayImage(relayRow.params) },
          });
        } catch (e) {
          const detail = e instanceof Error ? (e.stack || `${e.name}: ${e.message}`) : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
          console.error(`[wa-relay] فشل ${relayRow.kind} مكتب ${relayRow.towerId}:`, detail);
          // وتُمسَح الصورةُ عند الفشل أيضاً — فالصفُّ الفاشلُ **لا يُعاد تنفيذه** (يُنظَّف
          // بعد خمس دقائق)، فإبقاءُ ٤٠٠ كيلوبايتٍ فيه كلفةٌ بلا مقابلٍ أصلاً.
          await prisma.waRelay.update({ where: { id: relayRow.id }, data: { status: "error", error: String(detail).slice(0, 1500), params: scrubRelayImage(relayRow.params) } }).catch(() => {});
        }
      }
      // تنظيف الطلبات القديمة (منجزة أو فاشلة) الأقدم من 5 دقائق
      await prisma.waRelay.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 5 * 60_000) } } }).catch(() => {});
    } catch { /* تجاهل */ }
    finally { busy = false; }
  }, 2000);
}
