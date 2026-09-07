import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard, allowedTarget, debtFor, notifyTargetPhone } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;

  const b = await request.json().catch(() => null);
  const targetAgentId = Number(b?.targetAgentId);
  const tierId = Number(b?.tierId);
  const targetPackageId = Number(b?.targetPackageId);
  const count = Math.floor(Number(b?.count));
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 300) : null;

  if (!Number.isFinite(targetAgentId) || !Number.isFinite(tierId) || !Number.isFinite(targetPackageId)) {
    return NextResponse.json({ error: "بياناتٌ ناقصة" }, { status: 400 });
  }
  if (!Number.isFinite(count) || count < 1 || count > 5000) return NextResponse.json({ error: "عددٌ غير صالح" }, { status: 400 });

  if (!(await allowedTarget(distributorId, targetAgentId))) return NextResponse.json({ error: "هذا الوكيلُ ليس ضمن قائمتك" }, { status: 403 });

  const tier = await prisma.distributorTier.findFirst({ where: { id: tierId, distributorId, isDeleted: false } });
  if (!tier) return NextResponse.json({ error: "الفئةُ غير موجودة" }, { status: 400 });

  const pkg = await prisma.package.findFirst({ where: { id: targetPackageId, agentId: targetAgentId, isDeleted: false }, select: { id: true, name: true } });
  if (!pkg) return NextResponse.json({ error: "باقةُ الوكيل الهدف غير صالحة" }, { status: 400 });

  const unitPrice = tier.price ?? 0;
  const total = unitPrice * count;
  const now = new Date();

  let transferId: number;
  try {
    transferId = await prisma.$transaction(async (tx) => {
      const avail = await tx.distributorCard.findMany({
        where: { distributorId, tierId, transferId: null, isDeleted: false },
        take: count,
        orderBy: { id: "asc" },
        select: { id: true, serial: true, number: true, password: true },
      });
      if (avail.length < count) throw new Error("INSUFFICIENT");

      const transfer = await tx.distributorTransfer.create({
        data: { distributorId, targetAgentId, targetPackageId, tierId, count, unitPrice, total, note },
      });

      const ids = avail.map((c) => c.id);
      const claim = await tx.distributorCard.updateMany({ where: { id: { in: ids }, transferId: null }, data: { transferId: transfer.id } });
      if (claim.count !== ids.length) throw new Error("RACE");

      await tx.rechargeCard.createMany({
        data: avail.map((c) => ({
          agentId: targetAgentId,
          packageId: targetPackageId,
          serial: c.serial,
          number: c.number ?? c.serial,
          password: c.password,
          price: 0,
          addDate: now,
        })),
      });
      return transfer.id;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INSUFFICIENT") return NextResponse.json({ error: "مخزنُك لا يكفي لهذا العدد من الفئة" }, { status: 400 });
    if (msg === "RACE") return NextResponse.json({ error: "تعارضٌ لحظيّ — أعِد المحاولة" }, { status: 409 });
    if (/Unique constraint|P2002/i.test(msg)) return NextResponse.json({ error: "سيريالٌ مكرّرٌ لدى الوكيل الهدف — راجِع الأكواد" }, { status: 409 });
    return NextResponse.json({ error: "تعذّر إتمامُ التحويل" }, { status: 500 });
  }

  let remaining: number | null = null;
  let agentName: string | null = null;
  try {
    const debt = await debtFor(distributorId, targetAgentId);
    remaining = debt.remaining;
    const [target, agent] = await Promise.all([
      prisma.distributorTarget.findFirst({ where: { distributorId, targetAgentId, isDeleted: false }, select: { notifyPhone: true } }),
      prisma.agent.findUnique({ where: { id: targetAgentId }, select: { name: true } }),
    ]);
    agentName = agent?.name ?? null;
    await notifyTargetPhone(distributorId, target?.notifyPhone, `تعبئةُ كروت: ${count} كارت (${pkg.name ?? "باقة"}) بمبلغ ${total.toLocaleString("en-US")}.\nالمتبقّي عليك: ${remaining.toLocaleString("en-US")}.`);
  } catch {
    /* ثانويّ */
  }

  return NextResponse.json({ ok: true, transferId, count, total, remaining, agentName });
}
