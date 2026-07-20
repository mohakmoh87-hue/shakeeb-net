import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny } from "@/lib/guard";
import { DEFAULT_TEMPLATES, EVENT_TYPES, SEED_MARK } from "@/lib/smsTemplates";

const schema = z.object({
  templates: z.array(
    z.object({
      type: z.enum(EVENT_TYPES),
      text: z.string().default(""),
      enable: z.string().default("1"),
    }),
  ),
});

// جلب قوالب الأحداث (يزرع النصوص الافتراضية الثلاثة مرة واحدة لكل وكيل عند أول فتح)
export async function GET() {
  const g = await guardAny("templates.manage", "messaging.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;

  // زرع النصوص الافتراضية (تفعيل/تذكير/تسديد دين) مرة واحدة — تستبدل المكتوب سابقاً
  // (بقرار صريح من المالك)، وصفّ العلامة يمنع تكرار الاستبدال فتبقى تعديلات المستخدم بعدها.
  const marker = await prisma.smsTemplate.findFirst({ where: { type: SEED_MARK, agentId: agentId ?? -1 } });
  if (!marker) {
    for (const [type, text] of Object.entries(DEFAULT_TEMPLATES)) {
      const existing = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1 } });
      if (existing) await prisma.smsTemplate.update({ where: { id: existing.id }, data: { text } });
      else await prisma.smsTemplate.create({ data: { type, text, enable: "1", agentId } });
    }
    await prisma.smsTemplate.create({ data: { type: SEED_MARK, text: "", enable: "1", agentId } });
  }

  const rows = await prisma.smsTemplate.findMany({ where: { type: { in: [...EVENT_TYPES] }, agentId: agentId ?? -1 } });
  const map = new Map(rows.map((r) => [r.type, r]));
  const result = EVENT_TYPES.map((cat) => {
    const r = map.get(cat);
    return { type: cat, text: r?.text ?? DEFAULT_TEMPLATES[cat] ?? "", enable: r?.enable ?? "1" };
  });
  return NextResponse.json(result);
}

// حفظ (upsert) قوالب الأحداث دفعة واحدة
export async function POST(request: Request) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const agentId = g.session?.agentId ?? null; // عزل: قوالب وكيل المستخدم
  for (const t of parsed.data.templates) {
    const existing = await prisma.smsTemplate.findFirst({ where: { type: t.type, agentId: agentId ?? -1 } });
    if (existing) {
      await prisma.smsTemplate.update({ where: { id: existing.id }, data: { text: t.text, enable: t.enable } });
    } else {
      await prisma.smsTemplate.create({ data: { type: t.type, text: t.text, enable: t.enable, agentId } });
    }
  }
  return NextResponse.json({ ok: true });
}
