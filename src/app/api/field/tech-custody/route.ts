import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// مواد ذمّة فني معيّن (مع سعر البيع) — لاختيارها عند إنجاز البطاقة.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const technicianId = Number(new URL(request.url).searchParams.get("technicianId"));
  if (!technicianId) return NextResponse.json({ materials: [] });

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
