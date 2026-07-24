import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// لوحة «الكروت الوهمية» في حسابات المدير: كروت عُلِّمت مستخدمة في البرنامج بلا تفعيل مقابل في
// SAS (سجّلتها المزامنة بـ action=SYNC_PHANTOM_CARD بعد تحقّق مباشر بالبحث). «المعلَّق» = الكارت
// ما زال مستخدماً وموجوداً ويتبع وكيل المستخدم — فيسقط تلقائياً بعد الإرجاع (useDate=null) أو
// الحذف (اختفاء الصف). الإجراءات لا تمسّ الوصل ولا المال إطلاقاً (قرار المستخدم).

// GET — قائمة الكروت الوهمية المعلَّقة لوكيل المستخدم (مع اسم المشترك والمكتب ومبلغ الوصل للاطلاع)
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;

  // آخر 120 يوماً من تنبيهات الوهمي — أحدث تاريخ اكتشاف لكل كارت
  const since = new Date(Date.now() - 120 * 86400 * 1000);
  const audits = await prisma.auditLog.findMany({
    where: { action: "SYNC_PHANTOM_CARD", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true },
  });
  const detectedAt = new Map<number, Date>();
  for (const a of audits) {
    const id = Number(a.entityId);
    if (Number.isFinite(id) && !detectedAt.has(id)) detectedAt.set(id, a.createdAt);
  }
  const ids = [...detectedAt.keys()];
  if (ids.length === 0) return NextResponse.json({ cards: [] });

  // المعلَّق فقط: الكارت موجود، يتبع الوكيل، وما زال مستخدماً (لم يُرجَع/يُحذف)
  const cards = await prisma.rechargeCard.findMany({
    where: { id: { in: ids }, agentId, useDate: { not: null } },
    select: { id: true, serial: true, useDate: true, subscriberId: true },
  });

  // اسم المشترك ومكتبه
  const subIds = [...new Set(cards.map((c) => c.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true, towerId: true } })
    : [];
  const subById = new Map(subs.map((s) => [s.id, s]));
  const towerIds = [...new Set(subs.map((s) => s.towerId).filter((x): x is number => x != null))];
  const towers = towerIds.length
    ? await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } })
    : [];
  const towerName = new Map(towers.map((t) => [t.id, t.name]));

  // مبلغ آخر وصل تفعيل بنفس السيريال (للاطلاع فقط — لا يُلمَس)
  const serials = cards.map((c) => (c.serial ?? "").trim()).filter(Boolean);
  const entries = serials.length
    ? await prisma.subscriptionEntry.findMany({
        where: { card2: { in: serials }, isDeleted: false },
        orderBy: { date: "desc" },
        select: { card2: true, money: true },
      })
    : [];
  const amountBySerial = new Map<string, number | null>();
  for (const e of entries) {
    const s = (e.card2 ?? "").trim();
    if (s && !amountBySerial.has(s)) amountBySerial.set(s, e.money ?? null);
  }

  const list = cards.map((c) => {
    const sub = c.subscriberId != null ? subById.get(c.subscriberId) : null;
    return {
      cardId: c.id,
      serial: c.serial,
      subscriber: sub?.name ?? sub?.netUser ?? null,
      office: sub?.towerId != null ? (towerName.get(sub.towerId) ?? null) : null,
      useDate: c.useDate,
      amount: amountBySerial.get((c.serial ?? "").trim()) ?? null,
      detectedAt: detectedAt.get(c.id) ?? null,
    };
  });
  list.sort((a, b) => (b.detectedAt?.getTime() ?? 0) - (a.detectedAt?.getTime() ?? 0));
  return NextResponse.json({ cards: list });
}

const actionSchema = z.object({
  action: z.enum(["return", "delete"]),
  cardIds: z.array(z.coerce.number()).min(1, "لم تُحدَّد كروت"),
});

// POST — إجراء المدير على كروت وهمية محدّدة: إرجاع للمخزن أو حذف نهائي (بعزل agentId).
// لا يمسّ الوصل ولا المال — تحرير/حذف الكارت فقط.
export async function POST(request: Request) {
  const g = await guard("cards.delete");
  if (g.error) return g.error;
  const session = await getSession();
  const agentId = g.session?.agentId ?? -1;

  const body = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { action, cardIds } = parsed.data;

  if (action === "return") {
    // إرجاع للمخزن: تحرير الكارت فقط (يعود متاحاً) — دون لمس الوصل/المال/الأيام
    const res = await prisma.rechargeCard.updateMany({
      where: { id: { in: cardIds }, agentId },
      data: { useDate: null, subscriberId: null, userName: null, reservedBy: null, reservedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: session?.userId, action: "PHANTOM_CARD_RETURN", entity: "rechargeCard",
        entityId: cardIds.join(","), details: `إرجاع ${res.count} كارت وهمي للمخزن (تحرير الكارت فقط — بلا مساس بالوصل/المال)`,
      },
    });
    return NextResponse.json({ ok: true, affected: res.count });
  }

  // حذف نهائي من المخزن — دون لمس الوصل/المال
  const res = await prisma.rechargeCard.deleteMany({ where: { id: { in: cardIds }, agentId } });
  await prisma.auditLog.create({
    data: {
      userId: session?.userId, action: "PHANTOM_CARD_DELETE", entity: "rechargeCard",
      entityId: cardIds.join(","), details: `حذف ${res.count} كارت وهمي نهائياً من المخزن (بلا مساس بالوصل/المال)`,
    },
  });
  return NextResponse.json({ ok: true, affected: res.count });
}
