import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny } from "@/lib/guard";

const schema = z.object({
  type: z.string().min(1, "اسم القالب مطلوب"),
  text: z.string().nullable().optional(),
  enable: z.string().nullable().optional(),
});

export async function GET() {
  // القراءة متاحة لمن يدير القوالب أو الرسائل (قائمة القوالب الجاهزة في الإرسال)
  const g = await guardAny("templates.manage", "messaging.manage");
  if (g.error) return g.error;

  const templates = await prisma.smsTemplate.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const created = await prisma.smsTemplate.create({ data: parsed.data });
  return NextResponse.json(created, { status: 201 });
}
