import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  packageId: z.coerce.number(),
  serials: z.array(z.string()).min(1, "لا توجد كروت"),
});

// إضافة جماعية لسيريلات الكروت لفئة معيّنة (لصق سطر لكل كارت)
export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { packageId, serials } = parsed.data;

  // سعر كارت هذه الفئة المثبّت (يُطبَّق على الكروت الجديدة فقط)
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { cardCost: true } });
  const price = Number(pkg?.cardCost ?? 0);

  // تنظيف وإزالة الفراغات والمكرر
  const clean = [...new Set(serials.map((s) => s.trim()).filter(Boolean))];
  if (clean.length === 0) {
    return NextResponse.json({ error: "لا توجد سيريلات صحيحة" }, { status: 400 });
  }

  // استبعاد السيريلات الموجودة مسبقاً
  const existing = await prisma.rechargeCard.findMany({
    where: { serial: { in: clean } },
    select: { serial: true },
  });
  const existingSet = new Set(existing.map((e) => e.serial));
  const toAdd = clean.filter((s) => !existingSet.has(s));

  const res = await prisma.rechargeCard.createMany({
    data: toAdd.map((serial) => ({ serial, number: serial, packageId, price, addDate: new Date() })),
  });

  return NextResponse.json({
    ok: true,
    added: res.count,
    duplicates: clean.length - toAdd.length,
  });
}
