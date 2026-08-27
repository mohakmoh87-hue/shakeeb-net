import { prisma } from "@/lib/prisma";

// ═════ 🙈 سطورُ اللوحات والمكاتبُ المفصولة — قرارُ محمد 2026-08-26 (الثالث) ═════
//
// تدرّجَ الحكمُ ثلاثاً في يومٍ واحد على «↳ من فلان» (تفصيل أ-٢٣ للوحات الساس):
//   ١. تُخفى عن المستخدم المعزول ← ٢. عن كلّ غير مدير ← ٣. **وعن المدير أيضاً في
//   المكتب المفصول الحسابات**: لوحتا كاسبر مسمّاتان باسمَي الشريكَين، وللمدير هناك
//   تبويباتُ المستخدمين أصلاً — فبقاءُ سطور اللوحات معها ازدواجٌ يُقرأ أشخاصاً.
// 🔑 ومكتبُ اللوحتين **غيرُ المفصول** (صميم) تبقى لمديره كما هي حرفيّاً — فهو صاحبُ
//    الميزة الأصليّ («كم مفعَّلاً من ساس ١ وكم من ساس ٢») ولا تبويباتِ عنده تُزاحمها.
//
// 📍 والموضعُ في `api/_lib` عمداً: الترشيحُ عند الحافّة لا في `computeDailyReport`
//    (src/lib) — فتعديلُ src/lib يُعيد تشغيلَ حاسبات المكاتب كلِّها بلا داعٍ.

type PanelRow = { panelId: number; label: string; count: number };

/** يحذف من `activationsByPanel` سطورَ المكاتب المفصولة الحسابات (مستخدمان+ وفيهم مؤشَّر). */
// 🔴 والاسمُ **activationsByPanel** حرفيّاً لا الاسمُ الداخليُّ للمتغيّر: الأحكامُ الثلاثةُ الأولى (0829a95
// و6c47674 وd87b313) حذفت حقلاً بالاسم الداخليّ للمتغيّر لا باسم الإعادة، فكانت حذفَ عدمٍ
// نجحت اختباراتُه وثبتت السطورُ أمام محمد ثلاث مرّات. اختبارُ قفل الاسم العابرُ للملفّات يمنع رجوعها.
export async function stripSeparatedPanelRows(r: { activationsByPanel?: PanelRow[] }): Promise<void> {
  const rows = r.activationsByPanel;
  if (!rows?.length) return;
  const panels = await prisma.sasPanel.findMany({
    where: { id: { in: rows.map((p) => p.panelId) } },
    select: { id: true, towerId: true },
  });
  const towerIds = [...new Set(panels.map((p) => p.towerId))];
  if (!towerIds.length) return;
  // نفسُ تعريف «المكتب المفصول» المعتمد في reportUserScope — مستخدمان+ وفيهم مؤشَّر
  const users = await prisma.user.findMany({
    where: { towerId: { in: towerIds }, isDeleted: false, isActive: true, isOwner: false },
    select: { towerId: true, separateAccount: true },
  });
  const cnt = new Map<number, number>();
  const flagged = new Set<number>();
  for (const u of users) {
    cnt.set(u.towerId as number, (cnt.get(u.towerId as number) ?? 0) + 1);
    if (u.separateAccount) flagged.add(u.towerId as number);
  }
  const separated = new Set(towerIds.filter((t) => flagged.has(t) && (cnt.get(t) ?? 0) >= 2));
  if (!separated.size) return;
  const towerOfPanel = new Map(panels.map((p) => [p.id, p.towerId]));
  const kept = rows.filter((p) => !separated.has(towerOfPanel.get(p.panelId) ?? -1));
  if (kept.length) r.activationsByPanel = kept;
  else delete r.activationsByPanel;
}
