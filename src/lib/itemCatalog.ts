import { prisma } from "@/lib/prisma";

// ===== كتالوج المواد: اسمٌ واحد يراه كل المكاتب (قرار محمد 2026-08-05) =====
// كان كل مكتب مخزناً منفصلاً بأسمائه: المواصلات ٣٦ مادة، الشهداء ١٥، **والرسالة صفر**
// — فمستخدم الرسالة يفتح المخزن فيجده فارغاً، ولا يستطيع إنشاء مادة (وهذا صواب: الإنشاء
// للمدير وحده)، فيقف عاجزاً عن تسجيل ما اشتراه.
//
// القاعدة الآن: **أسماء المواد التي عرّفها المدير تظهر في كل مكاتبه ولو بكمية صفر**،
// والكميات تبقى مستقلة تماماً لكل مكتب. فالمستخدم يجد الاسم أمامه ويزيد كميته بعد الشراء
// (الزيادة فقط — لا إنقاص ولا إنشاء ولا حذف، وهي قيود مطبَّقة أصلاً في مسار المواد).

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// ذاكرة قصيرة تمنع إعادة الفحص مع كل فتح للشاشة (الفحص نفسه رخيص لكن لا داعي لتكراره)
const checked = new Map<number, number>();
const TTL_MS = 5 * 60 * 1000;

export function clearCatalogCache(officeId?: number) {
  if (officeId == null) checked.clear();
  else checked.delete(officeId);
}

// يضمن أن كل مكتب في القائمة يملك صفّاً لكل اسم في كتالوج الوكيل — الناقص يُنشأ بكمية صفر.
// لا يمسّ أي كمية قائمة، ولا يحذف شيئاً، ولا يوحّد أسعار المكاتب: كل مكتب يبقى بسعره وصنفه.
export async function ensureOfficeCatalog(
  agentId: number | null | undefined,
  officeIds: number[],
  opts: { force?: boolean } = {},
): Promise<number> {
  if (agentId == null || !officeIds.length) return 0;
  const now = Date.now();
  const targets = opts.force
    ? officeIds
    : officeIds.filter((id) => now - (checked.get(id) ?? 0) > TTL_MS);
  if (!targets.length) return 0;

  const towers = await prisma.tower.findMany({
    where: { agentId, isDeleted: false },
    select: { id: true },
  });
  const agentOffices = towers.map((t) => t.id);
  if (!agentOffices.length) return 0;

  const items = await prisma.item.findMany({
    where: { isDeleted: false, towerId: { in: agentOffices } },
    select: { id: true, name: true, category: true, priceSale: true, priceSale2: true, priceDinar: true, towerId: true },
    orderBy: { id: "asc" },
  });

  // تعريف كل اسم = أقدم صفّ يحمله (تعريف المدير الأول) — منه يُنسخ السعر والصنف
  const def = new Map<string, (typeof items)[number]>();
  for (const it of items) {
    const k = norm(it.name);
    if (k && !def.has(k)) def.set(k, it);
  }
  if (!def.size) {
    for (const id of targets) checked.set(id, now);
    return 0;
  }

  let created = 0;
  for (const officeId of targets) {
    if (!agentOffices.includes(officeId)) continue;
    const have = new Set(items.filter((i) => i.towerId === officeId).map((i) => norm(i.name)));
    const missing = [...def.values()].filter((d) => !have.has(norm(d.name)));
    if (missing.length) {
      await prisma.item.createMany({
        data: missing.map((d) => ({
          name: d.name,
          category: d.category,
          priceSale: d.priceSale,
          priceSale2: d.priceSale2,
          priceDinar: d.priceDinar,
          // الباركود لا يُنسخ: الصفّ الجديد بلا رصيد، ونسخه يجعل مسحاً واحداً يطابق صفوفاً عدة
          count: 0,
          towerId: officeId,
        })),
      });
      created += missing.length;
    }
    checked.set(officeId, now);
  }
  return created;
}
