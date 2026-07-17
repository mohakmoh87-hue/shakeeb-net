import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";

// ===== نظام مكافآت المشتركين (أكواد خصم) =====
// عند كل تفعيل يتراكم رصيد مكافأة (= مبلغ الباقة × عدد الأشهر) ويُولَّد كود 8 خانات
// ويُرسل للمشترك بواتساب. يُستخدم عند الصيانة أو البيع من المخزن كخصم، فيُخصم بحدّ
// الفاتورة ويبقى الباقي. عند انقطاع التجديد (فجوة) يُصفَّر الرصيد قبل المنح الجديد.

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
    createdByUser?: string;
    createdByName?: string;
  },
): Promise<{ code: string; balance: number; granted: number } | null> {
  const granted = Math.max(0, Math.round((opts.rewardAmount || 0) * (opts.months || 1)));
  if (granted <= 0) return null;
  const base = opts.hadGap ? 0 : Math.max(0, opts.currentBalance || 0);
  const balance = base + granted;
  const code = genRewardCode();
  await tx.subscriber.update({ where: { id: opts.subscriberId }, data: { rewardCode: code, rewardBalance: balance } });
  await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "grant", amount: granted, code, context: "activation", balanceAfter: balance,
      subscriberName: opts.subscriberName ?? null, createdByUser: opts.createdByUser ?? null, createdByName: opts.createdByName ?? null,
    },
  });
  return { code, balance, granted };
}

// ===== استخدام/خصم مكافأة عند الصيانة أو البيع (ضمن معاملة) =====
// يخصم بحدّ الفاتورة ويُبقي الباقي؛ ويُمسح الكود فقط عند نفاد الرصيد.
export async function redeemReward(
  tx: Prisma.TransactionClient,
  opts: {
    subscriberId: number;
    billAmount: number;
    context: "maintenance" | "sale";
    refId?: number | null;
    towerId: number | null;
    agentId: number | null;
    createdByUser?: string;
    createdByName?: string;
  },
): Promise<{ discount: number; balanceAfter: number; code: string | null; subscriberName: string | null } | null> {
  const sub = await tx.subscriber.findUnique({ where: { id: opts.subscriberId }, select: { rewardBalance: true, rewardCode: true, name: true } });
  const bal = sub?.rewardBalance ?? 0;
  if (bal <= 0) return null;
  const discount = Math.min(bal, Math.max(0, Math.round(opts.billAmount)));
  if (discount <= 0) return null;
  const balanceAfter = bal - discount;
  await tx.subscriber.update({
    where: { id: opts.subscriberId },
    data: { rewardBalance: balanceAfter, rewardCode: balanceAfter > 0 ? sub?.rewardCode ?? null : null },
  });
  await tx.rewardLog.create({
    data: {
      agentId: opts.agentId ?? null, towerId: opts.towerId ?? null, subscriberId: opts.subscriberId,
      kind: "redeem", amount: discount, code: sub?.rewardCode ?? null, context: opts.context, refId: opts.refId ?? null,
      balanceAfter, subscriberName: sub?.name ?? null, createdByUser: opts.createdByUser ?? null, createdByName: opts.createdByName ?? null,
    },
  });
  return { discount, balanceAfter, code: sub?.rewardCode ?? null, subscriberName: sub?.name ?? null };
}

const DEFAULT_GRANT_TPL =
  "مرحباً {name} 🎁\nحصلت على مكافأة تفعيل بمبلغ {granted} د.ع.\nرصيد مكافأتك الآن: {balance} د.ع\nكود المكافأة: {code}\nاستخدمه عند الصيانة أو الشراء من {office}.";
const DEFAULT_USED_TPL =
  "تم استخدام مكافأتك 🎉\nخُصِم {amount} د.ع.\nرصيدك المتبقّي: {balance} د.ع\n{office}";

// جلب قالب مكافأة لوكيل محدّد (عزل المستأجر). يعيد null إن كان معطّلاً صراحةً.
async function rewardTemplate(type: "reward" | "rewardUsed", agentId: number | null): Promise<string | null> {
  const t = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1 } });
  if (t && t.enable === "0") return null; // معطّل صراحةً
  const text = t?.text?.trim();
  return text && text.length > 0 ? text : (type === "reward" ? DEFAULT_GRANT_TPL : DEFAULT_USED_TPL);
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
    const tpl = await rewardTemplate("reward", a.agentId);
    if (!tpl) return;
    const text = renderTemplate(tpl, {
      name: a.name, netUser: a.netUser, code: a.code,
      balance: a.balance, granted: a.granted, amount: a.granted,
      office: office?.name ?? "شكيب نت",
    });
    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.officeId);
    await prisma.message.create({
      data: { channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text, status: res.ok ? "SENT" : "FAILED", error: res.error ?? null, createdByUser: a.createdByUser },
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
    const tpl = await rewardTemplate("rewardUsed", a.agentId);
    if (!tpl) return;
    const text = renderTemplate(tpl, { name: a.name, amount: a.discount, balance: a.balance, office: office?.name ?? "شكيب نت" });
    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.officeId);
    await prisma.message.create({
      data: { channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text, status: res.ok ? "SENT" : "FAILED", error: res.error ?? null, createdByUser: a.createdByUser },
    });
  } catch { /* تجاهل */ }
}
