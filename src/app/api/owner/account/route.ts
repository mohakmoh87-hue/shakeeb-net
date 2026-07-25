import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";

export const dynamic = "force-dynamic";

async function getSetting(type: string): Promise<string> {
  const s = await prisma.systemSetting.findFirst({ where: { type } });
  return s?.value ?? "";
}

async function setSetting(type: string, val: string) {
  const existing = await prisma.systemSetting.findFirst({ where: { type } });
  if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { value: val } });
  else await prisma.systemSetting.create({ data: { type, value: val } });
}

// بيانات حساب المالك (السوبر أدمن): يوزر/باسورد/إيميل استرجاع + رقم التواصل + إيميل النسخة الكاملة
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  const user = await prisma.user.findUnique({ where: { id: g.session!.userId }, select: { username: true, plainPassword: true, recoveryEmail: true } });
  return NextResponse.json({
    ...user,
    plainPassword: decryptSecret(user?.plainPassword),
    ownerPhone: await getSetting("ownerPhone"),
    ownerBackupEmail: await getSetting("ownerBackupEmail"),
    ownerBackupTime: await getSetting("ownerBackupTime"),
  });
}

const schema = z.object({
  username: z.string().min(1).optional(),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل").optional(),
  recoveryEmail: z.string().email("إيميل غير صالح").nullable().optional(),
  ownerPhone: z.string().nullable().optional(),
  ownerBackupEmail: z.string().email("إيميل غير صالح").or(z.literal("")).nullable().optional(),
  ownerBackupTime: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "الوقت بصيغة HH:MM").or(z.literal("")).nullable().optional(),
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
  if (d.password != null) { data.password = await hashPassword(d.password); data.plainPassword = encryptSecret(d.password); }
  if (d.recoveryEmail !== undefined) data.recoveryEmail = d.recoveryEmail?.trim() || null;
  if (Object.keys(data).length > 0) await prisma.user.update({ where: { id: uid }, data });

  // رقم التواصل العام (يظهر بصفحة الدخول)
  if (d.ownerPhone !== undefined) await setSetting("ownerPhone", d.ownerPhone?.trim() ?? "");
  // إيميل تصل إليه نسخة كاملة يومية لكل الوكلاء (النسخ الاحتياطي الشامل للمالك)
  if (d.ownerBackupEmail !== undefined) await setSetting("ownerBackupEmail", d.ownerBackupEmail?.trim() ?? "");
  // وقت الإرسال اليومي للنسخة الكاملة (HH:MM بتوقيت بغداد — تُرسل عند مطابقة الساعة)
  if (d.ownerBackupTime !== undefined) await setSetting("ownerBackupTime", d.ownerBackupTime?.trim() ?? "");

  return NextResponse.json({ ok: true });
}
