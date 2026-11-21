import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerScope } from "@/lib/viewerScope";
import { getOrCreateBoard } from "@/lib/field";
import { STANDARD_OPS, isSystemList } from "@/lib/fieldDefaults";

export const dynamic = "force-dynamic";

// 👁️ خيارات «عمليات» لمشاهد = أعمدةُ لوحة **مكتب المشترك** حصراً — نفسُ قاعدة
// `/api/field/ops` (عزلُ مكاتب، طلب محمد 2026-08-08)، لا كلُّ أنواع الوكيل.
// والمكتبُ يجب أن يكون **داخلَ نطاق المشاهد** لا نطاقَ وكيله فقط.
export async function GET(request: Request) {
  const sc = await viewerScope();
  if (!sc) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!Number.isInteger(officeId) || officeId <= 0) return NextResponse.json({ error: "مكتب غير صحيح" }, { status: 400 });
  if (!sc.towerIds.includes(officeId)) return NextResponse.json({ error: "المكتب خارج نطاقك" }, { status: 403 });

  const board = await getOrCreateBoard(officeId);
  const lists = await prisma.taskList.findMany({
    where: { boardId: board.id, isDeleted: false },
    orderBy: { position: "asc" }, select: { name: true },
  });
  const have = new Set(lists.map((l) => l.name.trim()));
  for (const op of STANDARD_OPS) {
    if (!have.has(op)) {
      const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
      await prisma.taskList.create({ data: { boardId: board.id, name: op, position: count } });
      lists.push({ name: op });
    }
  }
  const ops = [...new Set(lists.map((l) => l.name.trim()).filter((n) => n && !isSystemList(n)))];
  return NextResponse.json({ ops });
}
