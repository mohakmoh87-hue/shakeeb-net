import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny } from "@/lib/guard";

// التصنيفات الثابتة لقوالب الرسائل (#12)
const CATEGORIES = ["expiring", "activation", "debts", "maintenance", "other"] as const;

const schema = z.object({
  templates: z.array(
    z.object({
      type: z.enum(CATEGORIES),
      text: z.string().default(""),
      enable: z.string().default("1"),
    }),
  ),
});

// جلب القوالب المصنّفة (تُنشأ فارغة إن لم توجد)
export async function GET() {
  const g = await guardAny("templates.manage", "messaging.manage");
  if (g.error) return g.error;

  const rows = await prisma.smsTemplate.findMany({ where: { type: { in: [...CATEGORIES] } } });
  const map = new Map(rows.map((r) => [r.type, r]));
  const result = CATEGORIES.map((cat) => {
    const r = map.get(cat);
    return { type: cat, text: r?.text ?? "", enable: r?.enable ?? "1" };
  });
  return NextResponse.json(result);
}

// حفظ (upsert) القوالب المصنّفة دفعة واحدة
export async function POST(request: Request) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  for (const t of parsed.data.templates) {
    const existing = await prisma.smsTemplate.findFirst({ where: { type: t.type } });
    if (existing) {
      await prisma.smsTemplate.update({ where: { id: existing.id }, data: { text: t.text, enable: t.enable } });
    } else {
      await prisma.smsTemplate.create({ data: { type: t.type, text: t.text, enable: t.enable } });
    }
  }
  return NextResponse.json({ ok: true });
}
