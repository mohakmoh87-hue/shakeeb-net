import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== ذمم الفنيين (عهدة المواد) =====
// تسليم مواد لفني لا يُنقِص إجمالي المخزن (Item.count يبقى كما هو)،
// بل يُسجَّل أن كميّةً منها بحوزة الفني. بالمكتب = count − مجموع العهد.

// قائمة الذمم النشِطة (لكل فني ما بحوزته) — مقيّدة بمكتب المستخدم؛ المدير يرى الكل.
export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const rows = await prisma.custody.findMany({
    where: { isDeleted: false, qty: { gt: 0 }, ...towerScope(g.session) },
    orderBy: { id: "asc" },
  });
  const techIds = [...new Set(rows.map((r) => r.technicianId))];
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const [techs, items] = await Promise.all([
    prisma.technician.findMany({ where: { id: { in: techIds } }, select: { id: true, name: true } }),
    prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }),
  ]);
  const tn = new Map(techs.map((t) => [t.id, t.name]));
  const inm = new Map(items.map((i) => [i.id, i.name]));

  return NextResponse.json({
    custodies: rows.map((r) => ({
      id: r.id, technicianId: r.technicianId, itemId: r.itemId, qty: r.qty,
      technicianName: tn.get(r.technicianId) ?? `فني #${r.technicianId}`,
      itemName: inm.get(r.itemId) ?? `مادة #${r.itemId}`,
    })),
  });
}

const schema = z.object({
  technicianId: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  direction: z.enum(["give", "return"]).default("give"), // تسليم للفني / إرجاع للمكتب
});

export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = g.session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { technicianId, itemId, qty, direction } = parsed.data;

  const item = await prisma.item.findFirst({ where: { id: itemId, isDeleted: false } });
  if (!item) return NextResponse.json({ error: "المادة غير موجودة" }, { status: 404 });
  // الذمم تُسجَّل على الفني فقط (وليس الموظف العادي) — نتحقق من وجوده كفني
  const tech = await prisma.technician.findFirst({ where: { id: technicianId, isDeleted: false } });
  if (!tech) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  // عزل المكاتب: يجب أن يكون الفني والمادة في نفس مكتب المستخدم
  if (session && !session.isAdmin && session.towerId != null) {
    if (item.towerId !== session.towerId || tech.towerId !== session.towerId) {
      return NextResponse.json({ error: "الفني أو المادة ليست ضمن مكتبك" }, { status: 403 });
    }
  }
  if (item.towerId != null && tech.towerId != null && item.towerId !== tech.towerId) {
    return NextResponse.json({ error: "الفني والمادة من مكتبين مختلفين" }, { status: 400 });
  }

  const existing = await prisma.custody.findFirst({
    where: { technicianId, itemId, isDeleted: false },
  });

  if (direction === "give") {
    const custodyAgg = await prisma.custody.aggregate({
      where: { itemId, isDeleted: false }, _sum: { qty: true },
    });
    const atOffice = (item.count ?? 0) - (custodyAgg._sum.qty ?? 0);
    if (qty > atOffice) {
      return NextResponse.json({ error: `المتوفّر بالمكتب ${atOffice} فقط` }, { status: 400 });
    }
    if (existing) {
      await prisma.custody.update({ where: { id: existing.id }, data: { qty: existing.qty + qty } });
    } else {
      await prisma.custody.create({
        data: { technicianId, itemId, qty, towerId: item.towerId ?? tech.towerId ?? null },
      });
    }
  } else {
    // إرجاع للمكتب
    if (!existing || existing.qty < qty) {
      return NextResponse.json({ error: `بذمّة الفني ${existing?.qty ?? 0} فقط` }, { status: 400 });
    }
    await prisma.custody.update({ where: { id: existing.id }, data: { qty: existing.qty - qty } });
  }

  return NextResponse.json({ ok: true });
}
