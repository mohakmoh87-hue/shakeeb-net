import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET (فني): معرّف بصمة جهازه (إن سُجّلت) لتأكيد البصمة ببصمة الهاتف.
export async function GET() {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { bioCredId: true } });
  return NextResponse.json({ credId: t?.bioCredId ?? null });
}

// POST (فني): تسجيل معرّف بصمة الجهاز (بعد إنشاء بصمة WebAuthn على جهازه).
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = z.object({ credId: z.string().min(1).max(1000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  await prisma.technician.update({ where: { id: tech.technicianId }, data: { bioCredId: parsed.data.credId } });
  return NextResponse.json({ ok: true });
}
