import { NextResponse } from "next/server";
import { requireOwnerForBulk } from "@/lib/bulkDeleteGate";
import { captureCardsBeforeDelete, inspectPendingDeletedCards, GUARD_INLINE_MAX } from "@/lib/cardDeleteGuard";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  ids: z.array(z.coerce.number()).min(1, "لم تُحدَّد كروت"),
  // و-٤ · إذنُ المالك للدفعات الكبيرة (تُطلَب فوق BULK_DELETE_GATE فقط)
  ownerPassword: z.string().optional(),
});

// حذف جماعي لكروت التفعيل من المخزن نهائياً (صلاحية cards.delete).
// يُحذف من قاعدة البيانات كأنها لم تُضف، فينقص مبلغها من ديون الكارتات.
// يُسمح بحذف الكروت غير المستخدمة فقط (في المخزن).
export async function POST(request: Request) {
  const g = await guard("cards.delete");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }

  // عزل: لا يُحذف إلا كروت وكيل المستخدم غير المستخدمة
  const where = { id: { in: parsed.data.ids }, useDate: null, agentId: g.session?.agentId ?? -1 };
  // المبلغ الذي سينقص من «ديون الكارتات» — بنفس شرط الحذف حرفياً وقبله
  // (المحذوف فعلاً قد يقلّ عن المحدَّد، فتقدير المتصفح وحده يضلّل)
  // 🛡️ و-٤ · بوّابةُ الدفعة الكبيرة **قبل أيّ أثر**: العددُ يُقاس بشرطِ الحذف نفسِه
  //   (فالمحدَّدُ في المتصفّح قد يزيد عمّا يُحذَف فعلاً، والبوّابةُ تُبنى على الواقع).
  const doomedCount = await prisma.rechargeCard.count({ where });
  const gate = await requireOwnerForBulk({
    count: doomedCount, userId: g.session?.userId,
    ownerPassword: parsed.data.ownerPassword, what: "حذفٌ جماعيٌّ من صفحة الكروت",
  });
  if (gate) return gate;

  const agg = await prisma.rechargeCard.aggregate({ where, _sum: { price: true } });
  const removedDebt = agg._sum?.price ?? 0;
  // السيريلات قبل الحذف — الحذف فيزيائي فلا سبيل لمعرفتها بعده (المرحلة ٨)
  const doomed = await prisma.rechargeCard.findMany({ where, select: { serial: true }, take: 500 });
  // 🛡️ حارسُ المال · لقطةٌ قبل الحذف — لا مرورَ لكارتٍ بلا فحص
  const captured = await captureCardsBeforeDelete(parsed.data.ids, g.session?.agentId ?? null, g.session?.fullName ?? g.session?.username ?? null, "bulk");
  const res = await prisma.rechargeCard.deleteMany({ where });
  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId,
      action: "DELETE_CARDS", entity: "rechargeCard", entityId: String(res.count),
      details:
        "حذف " + res.count + " كارتاً — ينقص ديون الكارتات " +
        removedDebt.toLocaleString("en-US") + " — سيريلات: " +
        doomed.map((c) => c.serial).filter(Boolean).join(", ").slice(0, 4000),
    },
  });
  // ⚡ **يتصرّف الحارسُ فورَ الحذف** (طلبُ محمد 2026-08-14): حذفُ كارتٍ أو خمسة يُفحَص **قبل الردّ**
  //   فيصل الإشعارُ في ثوانٍ. وما فوق GUARD_INLINE_MAX يُفحَص بالخلفيّة ثمّ بالمسح الدوريّ
  //   — فبحثُ الساس ~١.٥ث للكارت، وحبسُ المستخدم دقائقَ ليس فحصاً صامتاً.
  if (captured > 0 && captured <= GUARD_INLINE_MAX) {
    await inspectPendingDeletedCards(captured).catch(() => {});
  } else if (captured > 0) {
    void inspectPendingDeletedCards(Math.min(captured, 200)).catch(() => {});
  }
  return NextResponse.json({ ok: true, deleted: res.count, removedDebt });
}
