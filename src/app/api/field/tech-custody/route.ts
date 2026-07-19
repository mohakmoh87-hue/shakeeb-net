import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// مواد ذمّة فني معيّن (مع سعر البيع) — لاختيارها عند إنجاز البطاقة.
// الفاعل: مستخدم المكتب (ذمّة أي فني ضمن وكيله) أو الفني نفسه (ذمّته حصراً).
export async function GET(request: Request) {
  const user = await getSession();
  const tech = user ? null : await getTechSession();
  if (!user && !tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  let technicianId: number;
  if (tech) {
    technicianId = tech.technicianId; // الفني يرى ذمّته فقط
  } else {
    technicianId = Number(new URL(request.url).searchParams.get("technicianId"));
    if (!technicianId) return NextResponse.json({ materials: [] });
    // عزل الوكيل: الفني المطلوب يجب أن يتبع وكيل المستخدم
    const t = await prisma.technician.findUnique({ where: { id: technicianId }, select: { agentId: true } });
    if (!t || t.agentId !== user!.agentId) return NextResponse.json({ materials: [] });
  }

  const rows = await prisma.custody.findMany({
    where: { technicianId, isDeleted: false, qty: { gt: 0 } },
    orderBy: { id: "asc" },
  });
  const items = await prisma.item.findMany({
    where: { id: { in: rows.map((r) => r.itemId) } },
    select: { id: true, name: true, priceSale: true },
  });
  const im = new Map(items.map((i) => [i.id, i]));

  return NextResponse.json({
    materials: rows.map((r) => ({
      itemId: r.itemId,
      name: im.get(r.itemId)?.name ?? `مادة #${r.itemId}`,
      priceSale: im.get(r.itemId)?.priceSale ?? 0,
      available: r.qty,
    })),
  });
}
