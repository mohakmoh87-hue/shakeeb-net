import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { can, type Permission } from "./rbac";
import type { SessionPayload } from "./auth";

// فلتر المكتب للاستعلامات: الأدمن يرى كل المكاتب، غيره يرى مكتبه فقط
export function towerScope(session: SessionPayload | null): { towerId?: number } {
  if (!session || session.isAdmin || session.towerId == null) return {};
  return { towerId: session.towerId };
}

// تحقق من ملكية سجل لمكتب المستخدم: الأدمن يملك كل المكاتب،
// غيره يملك مكتبه فقط. يُرجع true إذا كان مسموحاً للجلسة التعامل مع هذا المكتب.
export function ownsTower(session: SessionPayload | null, recordTowerId: number | null | undefined): boolean {
  if (!session) return false;
  if (session.isAdmin || session.towerId == null) return true;
  return recordTowerId === session.towerId;
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
