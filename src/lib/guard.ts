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

// مكاتبُ وكيلٍ بمعرّفٍ صريح (يعكس agentTowerIds بلا جلسةٍ داخليّة) — لبوّابة الشركة (القطعة ٧-ب):
// الشركةُ عامّةٌ بلا SessionPayload، فتقرأ مشتركي وكيلٍ **واحدٍ** عبر مكاتبه فقط، فلا تسريبَ بين وكلاء.
export async function towerIdsOfAgent(agentId: number): Promise<number[]> {
  const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
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

// ═════ حرسُ عزلِ مجموعةِ اللوحة (sharedFieldWith) — أخطرُ نقطةٍ في الميزة ═════
// المكتبُ الثانويُّ يشير لمكتبٍ رئيسيٍّ ليتشاركا لوحةَ الفنيين. لو قُبِلت القيمةُ بلا فحصٍ
// لأمكن مستخدمٌ ربطُ مكتبه بلوحةِ **وكيلٍ آخر** فيسحب فنّييه (نفسُ فئة ثغرة verifyManualAssignee).
// يُتحقَّق: الهدفُ ضمن **نفس الوكيل** · موجودٌ غيرُ محذوف · **رئيسيٌّ** (بلا سلسلة) · لا إحالةَ
// ذاتيّة · وهذا المكتبُ ليس رئيسيّاً لغيره (منعُ السلاسل من الطرفين). يُعيد رسالةَ خطأٍ أو null.
export async function validateSharedFieldWith(
  agentId: number | null, selfId: number | null, value: number | null | undefined,
): Promise<string | null> {
  if (value == null) return null; // فكُّ الربط جائزٌ دائماً
  if (agentId == null) return "لا وكيل مرتبط بحسابك";
  if (selfId != null && value === selfId) return "لا يمكن ربطُ المكتب بنفسه";
  const target = await prisma.tower.findUnique({
    where: { id: value },
    select: { agentId: true, isDeleted: true, sharedFieldWith: true },
  });
  if (!target || target.isDeleted) return "المكتب الرئيسيّ غير موجود";
  if (target.agentId == null || target.agentId !== agentId) return "المكتب الرئيسيّ ليس من حسابك";
  if (target.sharedFieldWith != null) return "المكتب الهدف تابعٌ لمجموعةٍ أخرى — اختر مكتباً رئيسيّاً";
  if (selfId != null) {
    const dependents = await prisma.tower.count({ where: { sharedFieldWith: selfId, isDeleted: false } });
    if (dependents > 0) return "هذا المكتب رئيسيٌّ لمكاتبَ أخرى — لا يصير ثانويّاً";
  }
  return null;
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

// ملكية على مستوى الوكيل (لا المكتب) — لعمليات تدفّق المشترك التي تُجرى من قائمة
// «عرض جميع المشتركين من كل المكاتب»: مستخدم مكتبٍ يخدم مشترك مكتبٍ آخر لنفس الوكيل
// (كان ownsTower يحصره بمكتبه فيفشل الحفظ بـ«المشترك غير موجود» بعد حرق الكارت في SAS).
// قرار محمد 2026-07-29: الوصل يُسجَّل على مكتب المشترك — وهذا ما تفعله المسارات أصلاً.
export async function sameAgentTower(session: SessionPayload | null, recordTowerId: number | null | undefined): Promise<boolean> {
  if (!session || recordTowerId == null) return false;
  const ids = await agentTowerIds(session);
  return ids.includes(recordTowerId);
}

// حارس مسارات المالك (Super Admin): للمالك فقط
export async function guardOwner() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  if (!session.isOwner) return { error: NextResponse.json({ error: "هذه الصفحة لمالك النظام فقط" }, { status: 403 }) };
  return { session };
}

// تأكيد كلمة سر السوبر أدمن (المالك) نفسه — للعمليات الحساسة (حذف وكيل، تغيير مفتاح القاعدة)
export async function confirmOwnerPassword(userId: number, password: string | undefined | null): Promise<boolean> {
  if (!password) return false;
  const { verifyPassword } = await import("@/lib/auth");
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { password: true, isOwner: true } });
  if (!owner?.isOwner) return false;
  return verifyPassword(password, owner.password);
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
