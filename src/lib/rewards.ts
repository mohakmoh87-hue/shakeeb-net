import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { renderTemplate, sendViaProvider, imageNote } from "@/lib/messaging";

// ===== نظام مكافآت المشتركين (أكواد خصم) =====
// عند كل تفعيل يتراكم رصيد مكافأة (= مبلغ الباقة × عدد الأشهر) ويُولَّد كود 8 خانات
// ويُرسل للمشترك بواتساب. يُستخدم عند الصيانة أو البيع من المخزن كخصم، فيُخصم بحدّ
// الفاتورة ويبقى الباقي. عند انقطاع التجديد (فجوة) يُصفَّر الرصيد قبل المنح الجديد.
// حد التراكم: 10 منح دون أي سحب ⇒ يتوقف المنح؛ أي سحب (كلي أو جزئي) يصفّر العدّاد
// فيستأنف المنح بكود جديد حتى الحد نفسه.

export const REWARD_MAX_GRANTS = 10;

// أحرف/أرقام بلا الملتبس (O0I1) — كود واضح للقراءة
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function genRewardCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// ===== منح مكافأة عند التفعيل (ضمن معاملة) =====
export async function grantReward(
  tx: Prisma.TransactionClient,
  opts: {
    subscriberId: number;
    towerId: number | null;
    agentId: number | null;
    subscriberName: string | null;
    currentBalance: number; // rewardBalance قبل هذا التفعيل
    hadGap: boolean;        // انقطاع تجديد (اشتراك منتهٍ) ⇒ يُصفَّر الرصيد أولاً
    rewardAmount: number;   // مبلغ مكافأة الباقة (لكل شهر)
    months: number;
    refId?: number | null;  // معرّف وصل التفعيل (لعكس المنح عند حذف الوصل)
    createdByUser?: string;
    createdByName?: string;
  },
): Promise<{ code: string; balance: number; granted: number } | null> {
  const granted = Math.max(0, Math.round((opts.rewardAmount || 0) * (opts.months || 1)));
  if (granted <= 0) return null;
  // حد التراكم: بلغ 10 منح دون سحب ⇒ لا مكافأة جديدة (انقطاع التجديد يبدأ عدّاً جديداً لأن الرصيد يُصفَّر)
  const cur = await tx.subscriber.findUnique({ where: { id: opts.subscriberId }, select: { rewardGrantCount: true } });
  const count = Math.max(0, cur?.rewardGrantCount ?? 0);
  if (!opts.hadGap && count >= REWARD_MAX_GRANTS) return null;
  const base = opts.hadGap ? 0 : Math.max(0, opts.currentBalance || 0);
  const balance = base + granted;
  const code = genRewardCode();
  await tx.subscriber.update({
    where: { id: opts.subscriberId },
    data: { rewardCode: code, rewardBalance: balance, rewardGrantCount: opts.hadGap ? 1 : count + 1 },
  });
  await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "grant", amount: granted, code, context: "activation", refId: opts.refId ?? null, balanceAfter: balance,
      subscriberName: opts.subscriberName ?? null, createdByUser: opts.createdByUser ?? null, createdByName: opts.createdByName ?? null,
    },
  });
  return { code, balance, granted };
}

// عكس منح مكافأة تفعيل عند حذف وصله: يُخصم مبلغ منح ذلك الوصل فقط من الرصيد الحالي
// (لا يؤثر على المبالغ السابقة). يُمسح الكود إن بلغ الرصيد صفراً.
export async function reverseRewardGrant(
  tx: Prisma.TransactionClient,
  opts: { entryId: number; subscriberId: number; towerId: number | null; agentId: number | null; createdByUser?: string; createdByName?: string },
): Promise<number> {
  // منح هذا الوصل (إن وُجد ولم يُعكَس سابقاً)
  const grant = await tx.rewardLog.findFirst({ where: { subscriberId: opts.subscriberId, refId: opts.entryId, kind: "grant" }, orderBy: { id: "desc" } });
  if (!grant) return 0;
  const already = await tx.rewardLog.findFirst({ where: { subscriberId: opts.subscriberId, refId: opts.entryId, kind: "reverse" } });
  if (already) return 0; // عُكِس مسبقاً
  const sub = await tx.subscriber.findUnique({ where: { id: opts.subscriberId }, select: { rewardBalance: true, rewardCode: true, name: true, rewardGrantCount: true } });
  const bal = sub?.rewardBalance ?? 0;
  const back = Math.min(bal, grant.amount); // لا يتجاوز الرصيد الحالي (قد يكون استُخدم جزئياً)
  const balanceAfter = Math.max(0, bal - back);
  await tx.subscriber.update({
    where: { id: opts.subscriberId },
    // عكس المنح يُنقص عدّاد التراكم واحداً (المنحة أُلغيت فلا تُحسب ضمن حد الـ10)
    data: { rewardBalance: balanceAfter, rewardCode: balanceAfter > 0 ? sub?.rewardCode ?? null : null, rewardGrantCount: Math.max(0, (sub?.rewardGrantCount ?? 0) - 1) },
  });
  await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "reverse", amount: back, code: grant.code, context: "activation-void", refId: opts.entryId, balanceAfter,
      subscriberName: sub?.name ?? null, createdByUser: opts.createdByUser ?? null, createdByName: opts.createdByName ?? null,
    },
  });
  return back;
}

// ═════ 🎁🛒 سياقُ طلبِ متجر الوكيل — معرّفٌ من عائلةٍ أخرى ═════
// قرارُ محمد 2026-11-04: رصيدُ المكافأة يُخصَم **لحظةَ إرسال الطلب** من إجماليّ السلّة،
// والطلبُ يصل الوكيلَ بسعرٍ بعد الخصم. و`refId` هنا معرّفُ **طلبِ متجرٍ** لا فاتورةٍ —
// والرقمان يتقاطعان حتماً (تسلسلان مستقلّان). فلولا السياقُ لعكست `reverseRewardRedeem`
// خصمَ طلبٍ عند حذف فاتورةٍ رقمُها يساويه، أو لظنّت فاتورةً مُعكَسةً وقد عُكِس طلبٌ.
// ⇒ كلُّ بحثٍ في عائلةٍ يستثني عائلةَ الأخرى صراحةً، والقديمُ (أيّاً كان سياقُه) يبقى للفاتورة.
export const STORE_ORDER_CTX = "store-order";
export const STORE_ORDER_VOID_CTX = "store-order-void";

// ===== استخدام/خصم مكافأة عند الصيانة أو البيع (ضمن معاملة) =====
// يخصم بحدّ الفاتورة ويُبقي الباقي؛ ويُمسح الكود فقط عند نفاد الرصيد.
export async function redeemReward(
  tx: Prisma.TransactionClient,
  opts: {
    subscriberId: number;
    billAmount: number;
    context: "maintenance" | "sale" | typeof STORE_ORDER_CTX;
    refId?: number | null;
    towerId: number | null;
    agentId: number | null;
    createdByUser?: string;
    createdByName?: string;
  },
): Promise<{ discount: number; balanceAfter: number; code: string | null; subscriberName: string | null; logId: number } | null> {
  const sub = await tx.subscriber.findUnique({ where: { id: opts.subscriberId }, select: { rewardBalance: true, rewardCode: true, name: true } });
  const bal = sub?.rewardBalance ?? 0;
  if (bal <= 0) return null;
  const discount = Math.min(bal, Math.max(0, Math.round(opts.billAmount)));
  if (discount <= 0) return null;
  const balanceAfter = bal - discount;
  // 🔴 عالٍ · خصمٌ ذرّيّ (اصطاده الفحصُ العدائيّ 2026-08-19):
  //   كان يُقرأ الرصيدُ ثمّ يُكتَب `rewardBalance: balanceAfter` (قيمةٌ مطلقة) ⇒ فاتورتان
  //   متزامنتان تقرآن نفسَ الرصيد، تخصمان مرّتَين، وتكتبان القيمةَ النهائيّةَ مرّةً ⇒ الوكيلُ
  //   يخسر خصماً لا يقابله رصيد. الآن: `decrement` ذرّيٌّ بشرطِ `rewardBalance >= discount`
  //   مع فحصِ العدّ — فإن سبقنا خصمٌ متزامنٌ نقص الرصيدَ، لا يُطابق الشرطُ فيُرفَض الخصمُ الثاني.
  const claimed = await tx.subscriber.updateMany({
    where: { id: opts.subscriberId, rewardBalance: { gte: discount } },
    // أي سحب (كلي أو جزئي) يصفّر عدّاد التراكم — يستأنف المنح بكود جديد حتى حد الـ10
    data: { rewardBalance: { decrement: discount }, rewardCode: balanceAfter > 0 ? sub?.rewardCode ?? null : null, rewardGrantCount: 0 },
  });
  if (claimed.count !== 1) return null; // سبقنا خصمٌ متزامنٌ استنفد الرصيد — لا خصمَ مزدوج
  const log = await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "redeem", amount: discount, code: sub?.rewardCode ?? null, context: opts.context, refId: opts.refId ?? null,
      balanceAfter, subscriberName: sub?.name ?? null, createdByUser: opts.createdByUser ?? null, createdByName: opts.createdByName ?? null,
    },
  });
  return { discount, balanceAfter, code: sub?.rewardCode ?? null, subscriberName: sub?.name ?? null, logId: log.id };
}

// ═════ 🔴 عالٍ (ب) · عكسُ خصم المكافأة عند حذف الفاتورة (المسحُ العدائيّ 2026-08-19) ═════
//
// كانت مرآةُ العكس ناقصةً اتجاهاً: عكسُ **المنح** موجودٌ (reverseRewardGrant أعلاه) وعكسُ
// **السحب** غائبٌ تماماً — فمشتركٌ استُخدم كودُه في فاتورةٍ ثمّ حُذفت عكسيّاً يفقد رصيدَه
// كلَّه إلى الأبد (البضاعةُ رجعت والمالُ أُلغي والمكافأةُ وحدَها لا تعود). نمطُ حادثة
// عليّ سهيل 2026-08-04 نفسُه الذي أُصلح فيه اتّجاهُ المنح وبقي السحبُ مكشوفاً.
//
// 🔑 السجلُّ يُربط بالفاتورة: صفُّ الخصم (kind:"redeem") صار يحمل refId = معرّفَ الفاتورة
//   (يربطه المُنادي بعد إنشائها في نفس المعاملة). فالعكسُ يجده بالمعرّف قطعيّاً.
// ⚖️ قراران محافظان موثَّقان:
//   · عدّادُ rewardGrantCount **لا يُستعاد**: صفّره السحبُ وقيمتُه السابقة لم تُخزَّن،
//     واختراعُ قيمةٍ أسوأُ من تركها — والعدّادُ يضبط إيقاعَ المنح القادم فقط، لا مالاً.
//   · خصومُ ما قبل هذا النشر (refId فارغ) لا تُعكَس آليّاً — يُسجَّل ذلك في التدقيق
//     بدل تخمينِ سجلٍّ قد يكون لغير هذه الفاتورة.
// 🔒 العزل: السجلُّ يُطابَق بالمشترك + الفاتورة، وكلاهما فُحصت ملكيّتُه في المسار المُنادي.
export async function reverseRewardRedeem(
  tx: Prisma.TransactionClient,
  opts: { invoiceId: number; subscriberId: number; towerId: number | null; agentId: number | null; createdByUser?: string },
): Promise<number> {
  const redeem = await tx.rewardLog.findFirst({
    // 🔑 استثناءُ سياق طلب المتجر: معرّفُه يساوي معرّفَ فاتورةٍ عاجلاً أو آجلاً (STORE_ORDER_CTX)
    where: { subscriberId: opts.subscriberId, refId: opts.invoiceId, kind: "redeem", NOT: { context: STORE_ORDER_CTX } },
    orderBy: { id: "desc" },
  });
  if (!redeem || redeem.amount <= 0) return 0;
  const already = await tx.rewardLog.findFirst({
    where: { subscriberId: opts.subscriberId, refId: opts.invoiceId, kind: "redeem-reverse", NOT: { context: STORE_ORDER_VOID_CTX } },
  });
  if (already) return 0; // عُكِس مسبقاً — لا إرجاعَ مزدوجاً لنفس الفاتورة

  // الإرجاعُ ذرّيّ (increment) — درسُ الحرِجة ٣: لا كتابةَ رصيدٍ مطلقةً من قراءةٍ سابقة
  await tx.subscriber.update({
    where: { id: opts.subscriberId },
    data: { rewardBalance: { increment: redeem.amount } },
  });
  const after = await tx.subscriber.findUnique({
    where: { id: opts.subscriberId },
    select: { rewardBalance: true, rewardCode: true, name: true },
  });
  // الكودُ يُستعاد فقط إن كان السحبُ قد محاه ولم يُمنَح كودٌ جديدٌ بعدَه
  if (after && !after.rewardCode && redeem.code) {
    await tx.subscriber.update({ where: { id: opts.subscriberId }, data: { rewardCode: redeem.code } });
  }
  await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "redeem-reverse", amount: redeem.amount, code: redeem.code,
      context: `${redeem.context ?? "?"}-void`, refId: opts.invoiceId,
      balanceAfter: after?.rewardBalance ?? 0, subscriberName: after?.name ?? null,
      createdByUser: opts.createdByUser ?? null,
    },
  });
  return redeem.amount;
}

// ═════ 🛒 إرجاعُ خصمِ طلبِ المتجر عند إلغائه أو رفضه (مرآةُ الخصم اللحظيّ) ═════
// الخصمُ يقع عند الإرسال، فالطلبُ الذي لم يصل صاحبَه يجب أن يُعيد رصيدَه كاملاً. يُنادى
// **داخل** معاملةِ تغييرِ الحالة وبعد نجاحِ الانتقال الذرّيّ وحدَه ⇒ انتقالٌ واحدٌ ينجح
// فإرجاعٌ واحدٌ يقع، ولو تزامن إلغاءٌ ورفضٌ. والصفُّ الموسومُ بـ`redeem-reverse` يحرسه مرّةً أخرى.
export async function reverseStoreOrderRedeem(
  tx: Prisma.TransactionClient,
  opts: { orderId: number; subscriberId: number; towerId: number | null; agentId: number | null; createdByUser?: string },
): Promise<number> {
  const redeem = await tx.rewardLog.findFirst({
    where: { subscriberId: opts.subscriberId, refId: opts.orderId, kind: "redeem", context: STORE_ORDER_CTX },
    orderBy: { id: "desc" },
  });
  if (!redeem || redeem.amount <= 0) return 0;
  const already = await tx.rewardLog.findFirst({
    where: { subscriberId: opts.subscriberId, refId: opts.orderId, kind: "redeem-reverse", context: STORE_ORDER_VOID_CTX },
  });
  if (already) return 0;
  await tx.subscriber.update({ where: { id: opts.subscriberId }, data: { rewardBalance: { increment: redeem.amount } } });
  const after = await tx.subscriber.findUnique({
    where: { id: opts.subscriberId },
    select: { rewardBalance: true, rewardCode: true, name: true },
  });
  if (after && !after.rewardCode && redeem.code) {
    await tx.subscriber.update({ where: { id: opts.subscriberId }, data: { rewardCode: redeem.code } });
  }
  await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "redeem-reverse", amount: redeem.amount, code: redeem.code,
      context: STORE_ORDER_VOID_CTX, refId: opts.orderId,
      balanceAfter: after?.rewardBalance ?? 0, subscriberName: after?.name ?? null,
      createdByUser: opts.createdByUser ?? null,
    },
  });
  return redeem.amount;
}

const DEFAULT_GRANT_TPL =
  "مرحباً {name} 🎁\nحصلت على مكافأة تفعيل بمبلغ {granted} د.ع.\nرصيد مكافأتك الآن: {balance} د.ع\nكود المكافأة: {code}\nاستخدمه عند الصيانة أو فاتورة المبيع في {office}.";
const DEFAULT_USED_TPL =
  "تم استخدام مكافأتك 🎉\nخُصِم {amount} د.ع.\nرصيدك المتبقّي: {balance} د.ع\n{office}";

// جلب قالب مكافأة: قالب المكتب المخصّص أولاً ثم قالب الوكيل العام (عزل المستأجر والمكتب).
// يعيد null إن كان القالب الغالب معطّلاً صراحةً.
// 🖼️ يعيد النصَّ **ومعه صورةُ القالب** (بلاغُ محمد 2026-08-22: كلُّ القوالب تقبل صورة)
async function rewardTemplateFull(type: "reward" | "rewardUsed", agentId: number | null, officeId?: number | null): Promise<{ text: string; image: string | null } | null> {
  const text = await rewardTemplate(type, agentId, officeId);
  if (!text) return null;
  let image: string | null = null;
  if (officeId != null) {
    const o = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: officeId }, select: { image: true } });
    image = o?.image?.trim() || null;
  }
  if (!image) {
    const a = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: null }, select: { image: true } });
    image = a?.image?.trim() || null;
  }
  return { text, image };
}

async function rewardTemplate(type: "reward" | "rewardUsed", agentId: number | null, officeId?: number | null): Promise<string | null> {
  const fallback = type === "reward" ? DEFAULT_GRANT_TPL : DEFAULT_USED_TPL;
  if (officeId != null) {
    const o = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: officeId } });
    if (o) {
      if (o.enable === "0") return null; // معطّل لهذا المكتب تحديداً
      const text = o.text?.trim();
      if (text) return text; // نص المكتب الفارغ يسقط لقالب الوكيل
    }
  }
  const t = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: null } });
  if (t && t.enable === "0") return null; // معطّل صراحةً
  const text = t?.text?.trim();
  return text && text.length > 0 ? text : fallback;
}

// إرسال رسالة منح المكافأة (بعد التفعيل، أفضل جهد — لا تُعطّل التفعيل)
export async function sendRewardGrantMessage(a: {
  subscriberId: number; officeId: number | null; agentId: number | null;
  phone: string | null; waEnabled: boolean | null; name: string | null; netUser: string | null;
  code: string; balance: number; granted: number; createdByUser?: string;
}): Promise<void> {
  try {
    if (a.waEnabled === false || !a.phone) return;
    const office = a.officeId ? await prisma.tower.findUnique({ where: { id: a.officeId }, select: { name: true, waEnabled: true } }) : null;
    if (office?.waEnabled === "0") return;
    const tpl = await rewardTemplateFull("reward", a.agentId, a.officeId);
    if (!tpl) return;
    const text = renderTemplate(tpl.text, {
      name: a.name, netUser: a.netUser, code: a.code,
      balance: a.balance, granted: a.granted, amount: a.granted,
      office: office?.name ?? "SHAKEEB",
    });
    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.officeId, tpl.image);
    await prisma.message.create({
      data: { channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text, status: res.ok ? "SENT" : "FAILED", error: res.error ?? imageNote(res), createdByUser: a.createdByUser },
    });
  } catch { /* لا نُفشل التفعيل بسبب رسالة */ }
}

// إرسال رسالة تأكيد استخدام الكود
export async function sendRewardUsedMessage(a: {
  subscriberId: number; officeId: number | null; agentId: number | null;
  phone: string | null; waEnabled: boolean | null; name: string | null;
  discount: number; balance: number; createdByUser?: string;
}): Promise<void> {
  try {
    if (a.waEnabled === false || !a.phone) return;
    const office = a.officeId ? await prisma.tower.findUnique({ where: { id: a.officeId }, select: { name: true, waEnabled: true } }) : null;
    if (office?.waEnabled === "0") return;
    const tpl = await rewardTemplateFull("rewardUsed", a.agentId, a.officeId);
    if (!tpl) return;
    const text = renderTemplate(tpl.text, { name: a.name, amount: a.discount, balance: a.balance, office: office?.name ?? "SHAKEEB" });
    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.officeId, tpl.image);
    await prisma.message.create({
      data: { channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text, status: res.ok ? "SENT" : "FAILED", error: res.error ?? imageNote(res), createdByUser: a.createdByUser, agentId: a.agentId ?? null },
    });
  } catch { /* تجاهل */ }
}
