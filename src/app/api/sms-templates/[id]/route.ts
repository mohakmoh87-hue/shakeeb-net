import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { EVENT_TYPES } from "@/lib/smsTemplates";

const schema = z.object({
  type: z.string().min(1, "اسم القالب مطلوب")
    .refine((v) => !v.startsWith("__"), "اسم القالب غير مسموح")
    .refine((v) => !(EVENT_TYPES as readonly string[]).includes(v), "هذا الاسم محجوز لقالب تلقائي"),
  text: z.string().nullable().optional(),
  enable: z.string().nullable().optional(),
});

// القوالب الحرّة فقط (قوالب الأحداث تُدار حصراً عبر bulk — لا تُعاد تسميتها ولا تُحذف من هنا)
const customOnly = { NOT: [{ type: { in: [...EVENT_TYPES] } }, { type: { startsWith: "__" } }] };

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const upd = await prisma.smsTemplate.updateMany({
    where: { id: Number(id), agentId: g.session?.agentId ?? -1, ...customOnly }, // عزل: قالب وكيل المستخدم
    data: parsed.data,
  });
  if (upd.count === 0) return NextResponse.json({ error: "القالب غير موجود ضمن حسابك" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;

  const { id } = await params;
  await prisma.smsTemplate.deleteMany({ where: { id: Number(id), agentId: g.session?.agentId ?? -1, ...customOnly } });
  return NextResponse.json({ ok: true });
}
