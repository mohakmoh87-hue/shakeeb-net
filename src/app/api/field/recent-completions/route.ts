import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isFieldManager } from "@/lib/field";

export const dynamic = "force-dynamic";

// البطاقات التي أُنجزت بعد وقت معيّن (للإشعار الفوري) — ضمن نطاق مكتب المستخدم؛ المدير يرى الكل.
export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const sinceStr = new URL(request.url).searchParams.get("since");
  const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 60 * 1000);

  const manager = isFieldManager(s);
  const techWhere = manager ? { isDeleted: false } : { isDeleted: false, towerId: s.towerId ?? null };
  const techs = await prisma.technician.findMany({ where: techWhere, select: { id: true, name: true } });
  const techMap = new Map(techs.map((t) => [t.id, t.name]));

  const cards = await prisma.taskCard.findMany({
    where: {
      done: true, isDeleted: false, settled: false,
      completedAt: { gt: since },
      technicianId: { in: techs.map((t) => t.id) },
    },
    orderBy: { completedAt: "asc" },
    select: { id: true, title: true, kind: true, amount: true, technicianId: true, completedAt: true },
  });

  return NextResponse.json({
    completions: cards.map((c) => ({
      id: c.id, title: c.title, kind: c.kind, amount: c.amount,
      technicianName: c.technicianId ? techMap.get(c.technicianId) ?? "فني" : "فني",
      completedAt: c.completedAt,
    })),
  });
}
