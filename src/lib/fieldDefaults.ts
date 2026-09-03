import { prisma } from "@/lib/prisma";

// ===== أعمدة/أنواع إدارة الفنيين القياسيّة (طلب محمد 2026-08-08) =====
// كلّ وكيل يملك الأنواع الخمسة القياسيّة (= خيارات «عمليات» الديناميّة)، وكلّ عمودٍ جديد
// يُولّد نوعه تلقائيّاً. الأعمدة النظاميّة (إلغاء/مكتمل/تذاكر أودو) لا تُولَّد لها أنواع.
export const STANDARD_OPS = ["صيانة", "تنصيب", "تحويل", "توصيل", "اعادة"] as const;

// أسماء أعمدةٍ نظاميّة (ليست عمليّات) — تُستثنى من توليد الأنواع ومن قائمة «عمليات»
const SYSTEM_LISTS = new Set(["الغاء", "الإلغاء", "إلغاء", "مكتمل", "المكتمل", "منجزة", "المنجزة", "تذاكر أودو"]);
export function isSystemList(name: string | null | undefined): boolean {
  return SYSTEM_LISTS.has(String(name ?? "").trim());
}

// عمودُ «الغاء» (بأشكاله) — تُستثنى بطاقاتُه من «المتبقّية» في مربّع الفنيّين
const CANCEL_LISTS = new Set(["الغاء", "الإلغاء", "إلغاء"]);
export function isCancelList(name: string | null | undefined): boolean {
  return CANCEL_LISTS.has(String(name ?? "").trim());
}

// يُنشئ نوع بطاقة باسمٍ ما إن لم يوجد (idempotent). يتخطّى الفارغ والنظاميّ.
export async function ensureCardType(agentId: number | null, name: string): Promise<void> {
  const n = String(name ?? "").trim();
  if (!n || agentId == null || isSystemList(n)) return;
  const exists = await prisma.cardType.findFirst({ where: { name: n, agentId, isDeleted: false }, select: { id: true } });
  if (exists) return;
  const count = await prisma.cardType.count({ where: { agentId, isDeleted: false } });
  await prisma.cardType.create({ data: { name: n, agentId, position: count, deliveryOnly: n === "توصيل" } });
}

// يعمل مرّةً واحدةً لكلّ وكيل في عمر العمليّة (يُصلح القائمين كسولاً عند أوّل وصول)
const ensured = new Set<number>();

// يضمن للوكيل: (١) الأنواع الخمسة، (٢) نوعاً لكلّ عمودٍ قائمٍ غير نظاميّ بلا نوع (إصلاح)،
// (٣) الأعمدة الخمسة على كلّ لوحة مكتب. idempotent وآمن (لا يُفشل الطلب الأصليّ).
export async function ensureFieldDefaults(agentId: number | null): Promise<void> {
  if (agentId == null || ensured.has(agentId)) return;
  ensured.add(agentId);
  try {
    // (١) الأنواع الخمسة القياسيّة
    for (const op of STANDARD_OPS) await ensureCardType(agentId, op);

    // لوحات مكاتب الوكيل
    const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
    const towerIds = towers.map((t) => t.id);
    if (towerIds.length) {
      const boards = await prisma.taskBoard.findMany({ where: { isDeleted: false, towerId: { in: towerIds } }, select: { id: true } });
      const boardIds = boards.map((b) => b.id);

      // (٢) إصلاح: نوعٌ لكلّ اسم عمودٍ قائمٍ غير نظاميّ بلا نوع
      if (boardIds.length) {
        const lists = await prisma.taskList.findMany({ where: { boardId: { in: boardIds }, isDeleted: false }, select: { name: true } });
        const names = [...new Set(lists.map((l) => l.name.trim()).filter((n) => n && !isSystemList(n)))];
        for (const n of names) await ensureCardType(agentId, n);
      }

      // (٣) الأعمدة الخمسة القياسيّة على كلّ لوحة مكتب
      for (const b of boards) {
        for (const op of STANDARD_OPS) {
          const has = await prisma.taskList.findFirst({ where: { boardId: b.id, name: op, isDeleted: false }, select: { id: true } });
          if (!has) {
            const count = await prisma.taskList.count({ where: { boardId: b.id, isDeleted: false } });
            await prisma.taskList.create({ data: { boardId: b.id, name: op, position: count } });
          }
        }
      }
    }
  } catch (e) {
    ensured.delete(agentId); // فشل ⇒ يُعاد لاحقاً
    console.error("[fieldDefaults] ensure failed:", e instanceof Error ? e.message : e);
  }
}
