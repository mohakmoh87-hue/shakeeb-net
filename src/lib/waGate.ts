// ═════ 🚦 بوّابةُ رقم الواتساب — فاصلٌ واحدٌ يحكم كلَّ الرسائل (طلبُ محمد 2026-08-25) ═════
//
// نصُّه: «أريد حارسَ الـ١٠ ثوانٍ في كلّ الرسائل إذا كانت أكثرَ من رسالةٍ في نفس الوقت،
// سواءٌ في طابورٍ أو بشكلٍ مباشر. وإذا جاء حدثٌ جديدٌ فينتظر اكتمالَ الطابور ليبدأ الإرسالَ
// بعده. وأريد أن أستطيع تغييرَ الـ١٠ ثوانٍ إلى أقلَّ أو أكثر».
//
// ═════ 🔴 لماذا لم يكن الفاصلُ ١٠ ثوانٍ أصلاً ═════
// كان الرقمُ مكتوباً في **ستّة مواضعَ منفصلة**، كلُّ واحدٍ يحسب فاصلَه ولا يعرف بالآخرين:
//   تذكيرُ الانتهاء · رسائلُ الديون · «المنتهون منذ N يوم» · طابورُ البثّ · طابورُ سجلّ
//   المزامنة · طابورُ «فعّل بنفسه».
// **وأحدَ عشرَ مساراً مباشراً بلا أيّ فاصل** (التفعيل · تسديدُ الدين · إنجازُ البطاقة ·
//   «لا يردّ» · الملخّص · المكافآت · رفعُ الكارت · القرض · تقريرُ المزامنة · الإرسالُ
//   الفوريُّ في سجلّ المزامنة).
// فمكتبٌ واحدٌ قد يكون عليه ستّةُ مُرسِلين في اللحظة نفسِها ⇒ **رسالةٌ كلَّ ثانيتَين على
// الرقم لا كلَّ عشر**. ودليلُه المقيسُ: دفعةُ الشدن **١٢ رسالةً في الدقيقة نفسِها (00:33)**.
//
// ═════ 🎯 لماذا هنا بالذات ═════
// كلُّ رسالةٍ في البرنامج — من أيّ مسارٍ ومن السحابة أو من أيّ حاسبة — تنتهي حتماً عند
// `sendWhatsAppLocal` **على الحاسبة المالكة لجلسة المكتب** (البقيّةُ تُمرَّر إليها عبر
// المُرحِّل). وبما أنّ الجلسةَ لا يملكها إلّا جهازٌ واحدٌ في اللحظة، فبوّابةٌ في تلك النقطة
// **تُسلسل كلَّ إرسالٍ على الرقم فعلاً** — لا في نصف المسارات كما كان.
// 🔑 والحراسةُ **لكلّ مكتبٍ على حدة**: الحظرُ يقع على الرقم، ولكلّ مكتبٍ رقمُه. وبوّابةٌ
//    عامّةٌ لكلّ الوكلاء كانت ستجعل بثَّ مكتبٍ واحدٍ يُجمّد رسائلَ كلّ المكاتب ساعاتٍ.

/** المسار: يدويٌّ يطلبه إنسانٌ الآن، أم دفعةٌ تعمل في الخلفيّة. */
export type WaLane = "urgent" | "bulk";

/** ⏳ علامةُ «لم يحن دورُه» — لا فشلَ إرسالٍ ولا رقمٌ خاطئ: **لم تُرسَل الرسالةُ إطلاقاً**.
 *  تقرؤها الطوابيرُ فتُعيد الصفَّ للانتظار بدل ختمه فاشلاً (ولا خطرَ تكرارٍ: لم يخرج شيء). */
export const WA_BUSY = "⏳ طابور الرقم مزدحم — يُعاد لاحقاً";
export const isWaBusy = (e?: string | null): boolean => !!e && e.includes("طابور الرقم مزدحم");

// ═════ ⏱️ الفاصلُ صار إعداداً (طلبُ محمد: «أستطيع تغييره لأقلَّ أو أكثر») ═════
// `waGapSeconds` لكلّ وكيلٍ عبر `getAgentSetting` — والافتراضيُّ ١٠ كما كان حرفيّاً، فمن
// لم يلمس الإعدادَ لا يتغيّر عنده شيء.
export const WA_GAP_DEFAULT = 10;
export const WA_GAP_MIN = 3;
export const WA_GAP_MAX = 60;

/** يُقصّ المدخَلُ إلى المدى المسموح — والقيمةُ الفاسدةُ تعود للافتراضيّ لا للصفر.
 *  🔒 وهذا الحارسُ في **الخادم**: قيمةُ `0` تعني رشقةً بلا فاصلٍ ⇒ حظرُ الرقم. */
export function clampGapSeconds(raw: string | number | null | undefined): number {
  const n = Math.round(Number(String(raw ?? "").trim()));
  if (!Number.isFinite(n) || n <= 0) return WA_GAP_DEFAULT;
  return Math.min(WA_GAP_MAX, Math.max(WA_GAP_MIN, n));
}

// الفاصلُ يُقرأ من القاعدة مرّةً كلَّ دقيقةٍ لكلّ مكتب — لا مع كلّ رسالة (استعلامٌ لكلّ
// رسالةٍ في بثٍّ من آلافٍ كلفةٌ بلا مقابل، والقيمةُ لا تتغيّر إلّا حين يفتح محمد الإعدادات).
const GAP_TTL_MS = 60_000;
const gapCache = new Map<number, { ms: number; at: number }>();

export async function waGapMs(officeId: number): Promise<number> {
  const hit = gapCache.get(officeId);
  if (hit && Date.now() - hit.at < GAP_TTL_MS) return hit.ms;
  let secs = WA_GAP_DEFAULT;
  try {
    // 🔑 استيرادٌ **متأخّرٌ** للقاعدة: البوّابةُ منطقُ توقيتٍ محضٌ لا يلزمه اتّصال، فتبقى
    //    قابلةً للاستيراد والاختبار بلا Prisma ولا DATABASE_URL.
    const { prisma } = await import("./prisma");
    const { getAgentSetting } = await import("./agentSettings");
    const t = await prisma.tower.findUnique({ where: { id: officeId }, select: { agentId: true } });
    secs = clampGapSeconds(await getAgentSetting("waGapSeconds", t?.agentId ?? null, String(WA_GAP_DEFAULT)));
  } catch { /* تعذّرت القراءةُ ⇒ الافتراضيُّ الآمن، لا صفر */ }
  const ms = secs * 1000;
  gapCache.set(officeId, { ms, at: Date.now() });
  return ms;
}

/** يُنسي المخزَّنَ فورَ الحفظ — فلا ينتظر الوكيلُ دقيقةً ليرى أثرَ ضبطه. */
export function forgetGapCache(): void { gapCache.clear(); }

// ═════ 🚦 البوّابة ═════
type Waiter = { go: () => void; dead: boolean };
type Gate = {
  /** لحظةُ **انتهاء** آخرِ إرسال — الفاصلُ يُقاس منها (كما كانت الحلقاتُ تفعل تماماً) */
  lastAt: number;
  held: boolean;
  urgent: Waiter[];
  bulk: Waiter[];
};
const gates = new Map<number, Gate>();
const gateOf = (id: number): Gate => {
  let g = gates.get(id);
  if (!g) { g = { lastAt: 0, held: false, urgent: [], bulk: [] }; gates.set(id, g); }
  return g;
};

/** كم رسالةً تنتظر دورَها على هذا الرقم الآن (للتشخيص وسجلّ الحاسبة). */
export function waQueueDepth(officeId: number): number {
  const g = gates.get(officeId);
  return g ? g.urgent.length + g.bulk.length : 0;
}

function passTurn(g: Gate): void {
  // 🚀 **المسارُ العاجلُ أوّلاً** (قرارُ محمد 2026-08-25): الفاصلُ محفوظٌ بين أيّ رسالتَين
  //    مهما كان مصدرُهما — والذي يتغيّر هو **الترتيبُ** وحدَه. فمشتركٌ واقفٌ أمام الموظّف
  //    لا ينتظر خلف بثٍّ من ألفَي رسالةٍ ساعاتٍ ثمّ تُختَم رسالتُه «فاشلة» وهي ستصل.
  let next = g.urgent.shift() ?? g.bulk.shift();
  while (next && next.dead) next = g.urgent.shift() ?? g.bulk.shift();
  if (next) next.go();          // الدورُ ينتقل ويبقى `held` — فلا يتسلّل ثالثٌ بينهما
  else g.held = false;
}

/**
 * يُنفّذ `fn` وقد ضَمِن أنّ الرقمَ لم يُرسِل شيئاً قبلها بأقلَّ من الفاصل، وأنّ لا إرسالَ
 * آخرَ يجري بالتوازي على المكتب نفسِه.
 *
 * @param maxWaitMs سقفُ الانتظار قبل التنازل. ولوجودِه سببان لا واحد:
 *   ① **مهلةُ المُرحِّل ٤٥ ثانية**: إرسالٌ ممرَّرٌ من السحابة ينتظر طويلاً يُختَم «غير
 *      مؤكَّدة» وهو لم يخرج — كذبةٌ في السجلّ. فالسقفُ للممرَّر قصيرٌ يبقيه تحت المهلة.
 *   ② **حارسُ الجمود**: نداءٌ انهار بلا تحريرٍ لا يُجمّد رقمَ المكتب إلى الأبد.
 * ويعود عند التجاوز بـ`WA_BUSY` — **ولم تُرسَل الرسالةُ**، فتُعيدها طوابيرُها بلا تكرار.
 */
export async function withWaTurn<T extends { ok: boolean; error?: string }>(
  officeId: number,
  lane: WaLane,
  maxWaitMs: number,
  fn: () => Promise<T>,
  /** تجاوزُ الفاصل — يُستعمل في الاختبارات وحيث تكون القيمةُ معروفةً سلفاً */
  gapOverrideMs?: number,
): Promise<T | { ok: false; error: string }> {
  const g = gateOf(officeId);

  if (g.held) {
    const me: Waiter = { go: () => {}, dead: false };
    const got = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { me.dead = true; resolve(false); }, maxWaitMs);
      me.go = () => { clearTimeout(timer); resolve(true); };
      (lane === "urgent" ? g.urgent : g.bulk).push(me);
    });
    if (!got) return { ok: false as const, error: WA_BUSY };
  } else {
    g.held = true;
  }

  // 🔑 الفاصلُ يُنتظَر **بعد** امتلاك الدور — فلا يعبر أحدٌ أثناء انتظاره.
  try {
    const gap = gapOverrideMs ?? await waGapMs(officeId);
    const rest = g.lastAt + gap - Date.now();
    if (rest > 0) await new Promise((r) => setTimeout(r, Math.min(rest, gap)));
    return await fn();
  } finally {
    // ⏱️ العدُّ من **لحظة الانتهاء** لا البداية — نفسُ سلوك `await sleep(GAP)` القديم
    //    الذي كان في ذيل كلّ حلقة، فلا يتغيّر إيقاعُ البثّ عمّا اعتاده الوكلاء.
    g.lastAt = Date.now();
    passTurn(g);
  }
}
