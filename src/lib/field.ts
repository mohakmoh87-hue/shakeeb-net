import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";

// لوحة إدارة الفنيين مستقلّة لكل مكتب (TaskBoard.towerId)، والمدير يرى كل المكاتب.

// هل الجلسة لمدير يرى كل المكاتب؟ (أدمن أو مستخدم بلا مكتب محدّد)
export function isFieldManager(session: SessionPayload): boolean {
  return !!session.isAdmin || session.towerId == null;
}

// المكتب الفعّال: مستخدم المكتب يُقصر على مكتبه؛ المدير يختار المكتب المطلوب.
export function resolveFieldOffice(session: SessionPayload, requested: number | null): number | null {
  if (!isFieldManager(session)) return session.towerId ?? null;
  return requested;
}

// لوحة المكتب (تُنشأ إن لم توجد) — لوحة واحدة لكل قيمة towerId.
export async function getOrCreateBoard(towerId: number | null) {
  let board = await prisma.taskBoard.findFirst({
    where: { towerId: towerId ?? null, isDeleted: false },
    orderBy: { id: "asc" },
  });
  if (!board) {
    board = await prisma.taskBoard.create({ data: { name: "إدارة الفنيين", towerId: towerId ?? null } });
  }
  return board;
}
