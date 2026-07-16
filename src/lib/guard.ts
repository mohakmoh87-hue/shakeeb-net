import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { prisma } from "./prisma";
import { can, type Permission } from "./rbac";
import type { SessionPayload } from "./auth";

// معرّفات مكاتب وكيل المستخدم (المستأجر) — أساس عزل البيانات بين الوكلاء.
// مالك النظام أو مستخدم بلا وكيل ⇒ لا مكاتب.
export async function agentTowerIds(session: SessionPayload | null): Promise<number[]> {
  if (!session || session.agentId == null) return [];
  const towers = await prisma.tower.findMany({
    where: { agentId: session.agentId, isDeleted: false },
    select: { id: true },
  });
  return towers.map((t) => t.id);
}

// فلتر المكتب للاستعلامات (معزول بالوكيل):
// - مستخدم مكتب ⇒ مكتبه فقط
// - مدير الوكيل (أدمن أو بلا مكتب) ⇒ كل مكاتب وكيله فقط (لا يرى مكاتب وكلاء آخرين)
export async function towerScope(session: SessionPayload | null): Promise<{ towerId?: number | { in: number[] } }> {
  if (!session) return { towerId: { in: [-1] } };
  if (!session.isAdmin && session.towerId != null) return { towerId: session.towerId };
  const ids = await agentTowerIds(session);
  return { towerId: { in: ids.length ? ids : [-1] } };
}

// فلتر «id المكتب» لقوائم المكاتب (prisma.tower.findMany) — معزول بالوكيل.
export async function agentOfficeFilter(session: SessionPayload | null): Promise<{ id?: number | { in: number[] } }> {
  if (session && !session.isAdmin && session.towerId != null) return { id: session.towerId };
  const ids = await agentTowerIds(session);
  return { id: { in: ids.length ? ids : [-1] } };
}

// تحقق تزامني من ملكية مكتب ضمن مجموعة مكاتب معروفة (تُجلب مرّة عبر agentTowerIds)
export function ownsTowerIn(session: SessionPayload | null, recordTowerId: number | null | undefined, agentTowers: number[]): boolean {
  if (!session) return false;
  if (!session.isAdmin && session.towerId != null) return recordTowerId === session.towerId;
  return recordTowerId != null && agentTowers.includes(recordTowerId);
}

// تحقق غير متزامن من ملكية سجل لمكتب ضمن وكيل المستخدم (عزل المستأجر).
export async function ownsTower(session: SessionPayload | null, recordTowerId: number | null | undefined): Promise<boolean> {
  if (!session) return false;
  if (!session.isAdmin && session.towerId != null) return recordTowerId === session.towerId;
  if (recordTowerId == null) return false;
  const ids = await agentTowerIds(session);
  return ids.includes(recordTowerId);
}

// حارس لمسارات الـ API: يتحقق من الجلسة والصلاحية
// يُرجع الجلسة عند النجاح، أو NextResponse بخطأ عند الفشل
export async function guard(permission: Permission) {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }),
    };
  }
  if (!can(session, permission)) {
    return {
      error: NextResponse.json(
        { error: "ليس لديك صلاحية لهذا الإجراء" },
        { status: 403 },
      ),
    };
  }
  return { session };
}

// حارس يقبل أياً من صلاحيات متعددة
export async function guardAny(...permissions: Permission[]) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  if (permissions.some((perm) => can(session, perm))) return { session };
  return { error: NextResponse.json({ error: "ليس لديك صلاحية لهذا الإجراء" }, { status: 403 }) };
}
