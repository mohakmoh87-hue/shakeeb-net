import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// مواد ذمّة فني معيّن (مع سعر البيع) — لاختيارها عند إنجاز البطاقة.
// الفاعل: مستخدم المكتب (ذمّة أي فني ضمن وكيله) أو الفني نفسه (ذمّته حصراً).
export async function GET(request: Request) {
  const user = await getSession();
  const tech = user ? null : await getTechSession();
  if (!user && !tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  let technicianId: number;
  if (tech) {
    technicianId = tech.technicianId; // الفني يرى ذمّته فقط
  } else {
    technicianId = Number(new URL(request.url).searchParams.get("technicianId"));
    if (!technicianId) return NextResponse.json({ materials: [] });
    // عزل الوكيل: الفني المطلوب يجب أن يتبع وكيل المستخدم
    const t = await prisma.technician.findUnique({ where: { id: technicianId }, select: { agentId: true } });
    if (!t || t.agentId !== user!.agentId) return NextResponse.json({ materials: [] });
  }

  // ===== أثناء الدعم: ذمّتُه **كلُّها** تظهر (قرارُ محمد 2026-11-13) =====
  // كان حصراً على موادّ مكتب الدعم (قرارُ 2026-08-09) فاختفت عن الفنيّ مادّةٌ يحملها
  // معه فعلاً من مكتبه ولم يستطع بيعَها على بطاقة الدعم. والمحاسبةُ تستقيم بالترحيل
  // الآليّ عند الإنجاز: مخزنُ مكتبه ينقص، والفاتورةُ والمالُ لمكتب البطاقة، وسطرُ
  // ترحيلٍ في سجلّ «الترحيلات والذمم» يوثّق انتقالَ البضاعة بين المكتبَين.
  const supOffice = (await prisma.technician.findUnique({
    where: { id: technicianId }, select: { supportTowerId: true },
  }))?.supportTowerId ?? null;

  const rows = await prisma.custody.findMany({
    where: { technicianId, isDeleted: false, qty: { gt: 0 } },
    orderBy: { id: "asc" },
  });
  const items = await prisma.item.findMany({
    where: { id: { in: rows.map((r) => r.itemId) } },
    select: { id: true, name: true, priceSale: true, towerId: true },
  });
  const im = new Map(items.map((i) => [i.id, i]));
  // اسمُ المكتب المالك — يُعرَض على المادّة الغريبة وحدَها («من مخزن …») لئلّا يبيعها غافلاً
  const foreignTowers = [...new Set(items.map((i) => i.towerId).filter((t): t is number => t != null && supOffice != null && t !== supOffice))];
  const towerName = new Map(
    (foreignTowers.length ? await prisma.tower.findMany({ where: { id: { in: foreignTowers } }, select: { id: true, name: true } }) : [])
      .map((t) => [t.id, t.name ?? `مكتب #${t.id}`]),
  );

  return NextResponse.json({
    materials: rows.filter((r) => im.has(r.itemId)).map((r) => {
      const it = im.get(r.itemId)!;
      const foreign = supOffice != null && it.towerId != null && it.towerId !== supOffice;
      return {
        itemId: r.itemId,
        name: it.name ?? `مادة #${r.itemId}`,
        priceSale: it.priceSale ?? 0,
        available: r.qty,
        // بيعُها على بطاقة الدعم يُرحّلها آليّاً من مكتبها إلى مكتب البطاقة
        foreign,
        officeName: foreign && it.towerId != null ? (towerName.get(it.towerId) ?? null) : null,
      };
    }),
    supportOnly: supOffice != null,
  });
}
