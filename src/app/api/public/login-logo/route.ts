import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// شعار صفحة الدخول (عام لكل النظام — الصفحة قبل الدخول لا تعرف الوكيل):
// data URL في system_settings بمفتاح loginLogo، وتبديله للسوبر أدمن حصراً
// (طلب محمد 2026-07-29). عند غيابه تعرض الصفحة الافتراضي /icons/logo.png.
const TYPE = "loginLogo";

export async function GET() {
  const row = await prisma.systemSetting.findFirst({ where: { type: TYPE }, select: { text: true } });
  return NextResponse.json({ logo: row?.text ?? null });
}

export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
  if (!dataUrl.startsWith("data:image/")) return NextResponse.json({ error: "اختر صورة صالحة" }, { status: 400 });
  if (dataUrl.length > 300_000) return NextResponse.json({ error: "الصورة كبيرة — اختر صورة أصغر" }, { status: 400 });
  const row = await prisma.systemSetting.findFirst({ where: { type: TYPE }, select: { id: true } });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text: dataUrl } });
  else await prisma.systemSetting.create({ data: { type: TYPE, text: dataUrl } });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const g = await guardOwner();
  if (g.error) return g.error;
  await prisma.systemSetting.deleteMany({ where: { type: TYPE } });
  return NextResponse.json({ ok: true });
}
