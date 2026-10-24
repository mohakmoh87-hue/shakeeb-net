import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentAppTables } from "@/lib/agentAppOffers";

export const dynamic = "force-dynamic";

// 📦 نشرُ باقات الاشتراك في صفحة «الباقات والعروض» بتطبيق المشترك (طلبُ محمد 2026-10-24).
// الأسعارُ تُقرأ من `packages` حيّاً ولا تُنسَخ — فما يراه المشتركُ هو ما في صفحة الباقات
// بالضبط. والمنشورُ سطرٌ في `agent_app_packages`؛ وما لا سطرَ له **غيرُ منشور** (الوكيل
// يُضيف ما يشاء، فلا يظهر شيءٌ قبل أن يختار).
export async function GET() {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentAppTables();
  const [pkgs, published] = await Promise.all([
    prisma.package.findMany({
      where: { agentId, isDeleted: false },
      select: { id: true, name: true, priceDinar: true },
      orderBy: [{ priceDinar: "asc" }, { id: "asc" }],
    }),
    prisma.agentAppPackage.findMany({ where: { agentId }, select: { packageId: true, visible: true, note: true, sort: true } }),
  ]);
  const byId = new Map(published.map((r) => [r.packageId, r]));
  return NextResponse.json({
    items: pkgs
      .filter((p) => (p.name ?? "").trim())
      .map((p) => {
        const row = byId.get(p.id);
        return {
          id: p.id,
          name: (p.name ?? "").trim(),
          price: p.priceDinar != null ? Math.round(p.priceDinar) : null,
          published: !!row,
          visible: row?.visible ?? false,
          note: row?.note ?? "",
          sort: row?.sort ?? 0,
        };
      }),
  });
}

// نشرُ باقةٍ أو إخفاؤها أو تعديلُ وصفها — عزلٌ مزدوج: الباقةُ لوكيل الجلسة، والسطرُ كذلك.
export async function PATCH(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذه الجلسة" }, { status: 400 });
  await ensureAgentAppTables();
  const b = await request.json().catch(() => null);
  const packageId = Number(b?.packageId) || 0;
  if (!packageId) return NextResponse.json({ error: "packageId مطلوب" }, { status: 400 });
  // 🔒 لا تُنشَر باقةُ وكيلٍ آخر
  const own = await prisma.package.findFirst({ where: { id: packageId, agentId, isDeleted: false }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "الباقة غير موجودة" }, { status: 404 });

  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 200) : undefined;
  const sortRaw = Number(b?.sort);
  const sort = Number.isFinite(sortRaw) ? Math.max(0, Math.min(999, Math.round(sortRaw))) : undefined;

  if (b?.published === false) {
    // إلغاءُ النشر: يُخفى ولا يُحذف سطرُه (يبقى وصفُه وترتيبُه لو أعاد نشرَه)
    await prisma.agentAppPackage.updateMany({ where: { agentId, packageId }, data: { visible: false } });
    return NextResponse.json({ ok: true, visible: false });
  }

  const visible = b?.visible === false ? false : true;
  await prisma.agentAppPackage.upsert({
    where: { agentId_packageId: { agentId, packageId } },
    create: { agentId, packageId, visible, note: note ?? null, sort: sort ?? 0 },
    update: { visible, ...(note !== undefined ? { note: note || null } : {}), ...(sort !== undefined ? { sort } : {}) },
  });
  return NextResponse.json({ ok: true, visible });
}
