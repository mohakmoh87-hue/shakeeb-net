import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getOwnerPhone(): Promise<string> {
  const s = await prisma.systemSetting.findFirst({ where: { type: "ownerPhone" } });
  return s?.value ?? "";
}

// بيانات حساب المالك (السوبر أدمن): يوزر/باسورد/إيميل استرجاع + رقم التواصل العام
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  const user = await prisma.user.findUnique({ where: { id: g.session!.userId }, select: { username: true, plainPassword: true, recoveryEmail: true } });
  return NextResponse.json({ ...user, ownerPhone: await getOwnerPhone() });
}

const schema = z.object({
  username: z.string().min(1).optional(),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل").optional(),
  recoveryEmail: z.string().email("إيميل غير صالح").nullable().optional(),
  ownerPhone: z.string().nullable().optional(),
});

export async function PATCH(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const d = parsed.data;
  const uid = g.session!.userId;

  const data: Record<string, unknown> = {};
  if (d.username != null) {
    const taken = await prisma.user.findUnique({ where: { username: d.username } });
    if (taken && taken.id !== uid) return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
    data.username = d.username;
  }
  if (d.password != null) { data.password = await hashPassword(d.password); data.plainPassword = d.password; }
  if (d.recoveryEmail !== undefined) data.recoveryEmail = d.recoveryEmail?.trim() || null;
  if (Object.keys(data).length > 0) await prisma.user.update({ where: { id: uid }, data });

  // رقم التواصل العام (يظهر بصفحة الدخول)
  if (d.ownerPhone !== undefined) {
    const val = d.ownerPhone?.trim() ?? "";
    const existing = await prisma.systemSetting.findFirst({ where: { type: "ownerPhone" } });
    if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { value: val } });
    else await prisma.systemSetting.create({ data: { type: "ownerPhone", value: val } });
  }

  return NextResponse.json({ ok: true });
}
