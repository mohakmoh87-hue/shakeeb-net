import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";

// لوحة إدارة الفنيين مستقلّة لكل مكتب (TaskBoard.towerId)، والمدير يرى كل المكاتب.

// هل الجلسة لمدير يرى كل المكاتب؟ (أدمن أو مستخدم بلا مكتب محدّد)
export function isFieldManager(session: SessionPayload): boolean {
  return !!session.isAdmin || session.towerId == null;
}

// المكتب الفعّال: أي مستخدم يستطيع عرض/مساعدة أي مكتب (تعاون بين المكاتب وقت الضغط).
// عند عدم تحديد مكتب: المدير يبدأ بلا مكتب (أول مكتب)، ومستخدم المكتب يبدأ بمكتبه.
export function resolveFieldOffice(session: SessionPayload, requested: number | null): number | null {
  if (requested != null) return requested;
  return isFieldManager(session) ? null : session.towerId ?? null;
}

// حساب "نثرية" للمكتب (مقبوضات متفرقة) — يُنشأ إن لم يوجد.
export async function getOrCreatePettyAccount(towerId: number | null) {
  let acc = await prisma.account.findFirst({
    where: { name: "نثرية", towerId: towerId ?? null, isDeleted: false },
  });
  if (!acc) {
    acc = await prisma.account.create({ data: { name: "نثرية", typeName: "مقبوضات", towerId: towerId ?? null } });
  }
  return acc;
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
