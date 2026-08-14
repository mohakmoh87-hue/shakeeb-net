import { prisma } from "@/lib/prisma";
import { ensureFieldDefaults, STANDARD_OPS } from "@/lib/fieldDefaults";

// ═════ أ-٣ · الأعمدةُ الافتراضيّةُ **تُزرَع مرّةً واحدةً** ولا تعود (طلب محمد) ═════
//
// كان «الإصلاحُ الكسول» في `fieldDefaults.ts` يُعيد إنشاءَ الناقص عند كلّ وصول، فحذفُ
// الوكيل عموداً افتراضيّاً أو تسميتُه لا يثبتان — يعود العمودُ باسمه القديم في الزيارة
// التالية. وقرارُ محمد: «إن حذفها لا تعود، وإن غيّر اسمَها لا يرجع الاسمُ الأصليّ —
// فهي ليست إلزاميّةً بحال». ⇒ الغيابُ بعد الزرع الأوّل **قرارٌ** لا نقصٌ يُصلَح.
//
// البنية (بلا لمسِ `src/lib` — فذلك يُعيد تشغيل عمّال الحاسبات):
//   · علامةُ وكيلٍ  `fieldSeeded:{agentId}`        — الأنواعُ الخمسة + إصلاحُ القائمين، مرّة.
//   · علامةُ لوحةٍ  `fieldSeeded:board:{boardId}`   — الأعمدةُ الخمسة، مرّةً لكلّ لوحة. فالمكتبُ
//     الجديدُ (لوحتُه تُنشأ كسولاً في `field.ts`) يأخذ أعمدتَه في أوّل زيارة، ثمّ تُختم لوحتُه.

const agentKey = (agentId: number) => `fieldSeeded:${agentId}`;
const boardKey = (boardId: number) => `fieldSeeded:board:${boardId}`;

export async function ensureFieldDefaultsOnce(agentId: number | null): Promise<void> {
  if (agentId == null) return;
  try {
    const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
    const boards = towers.length
      ? await prisma.taskBoard.findMany({ where: { isDeleted: false, towerId: { in: towers.map((t) => t.id) } }, select: { id: true } })
      : [];

    const agentSealed = await prisma.systemSetting.findFirst({ where: { type: agentKey(agentId) }, select: { id: true } });
    if (!agentSealed) {
      // الزرعُ الأوّل الكامل (الأنواع + إصلاح القائمين + أعمدة كلّ اللوحات) — ثمّ الختم
      await ensureFieldDefaults(agentId);
      await prisma.systemSetting.createMany({
        data: [
          { type: agentKey(agentId), text: "زُرعت الأنواع والأعمدة الافتراضية — لا تُعاد", value: new Date().toISOString().slice(0, 10) },
          ...boards.map((b) => ({ type: boardKey(b.id), text: "زُرعت أعمدة اللوحة", value: new Date().toISOString().slice(0, 10) })),
        ],
      });
      return;
    }

    // الوكيلُ مختوم: لا إصلاحَ كسولاً بعد اليوم. يبقى فقط زرعُ لوحةٍ **جديدة** لم تُختم
    // (مكتبٌ أُنشئ بعد الختم) — تأخذ الأعمدةَ الخمسة مرّةً ثمّ تُختم هي الأخرى.
    if (!boards.length) return;
    const sealed = new Set(
      (await prisma.systemSetting.findMany({
        where: { type: { in: boards.map((b) => boardKey(b.id)) } }, select: { type: true },
      })).map((s) => s.type),
    );
    const fresh = boards.filter((b) => !sealed.has(boardKey(b.id)));
    for (const b of fresh) {
      for (const op of STANDARD_OPS) {
        const has = await prisma.taskList.findFirst({ where: { boardId: b.id, name: op, isDeleted: false }, select: { id: true } });
        if (!has) {
          const count = await prisma.taskList.count({ where: { boardId: b.id, isDeleted: false } });
          await prisma.taskList.create({ data: { boardId: b.id, name: op, position: count } });
        }
      }
      await prisma.systemSetting.create({ data: { type: boardKey(b.id), text: "زُرعت أعمدة اللوحة", value: new Date().toISOString().slice(0, 10) } });
    }
  } catch (e) {
    // الزرعُ زينةُ أوّلِ استعمالٍ — لا يُفشل الطلبَ الأصليّ أبداً
    console.error("[fieldSeed] ensure-once failed:", e instanceof Error ? e.message : e);
  }
}
