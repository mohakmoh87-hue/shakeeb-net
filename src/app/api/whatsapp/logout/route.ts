import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logoutWhatsApp } from "@/lib/whatsapp";

// تسجيل الخروج من واتساب مكتب محدّد (متاح للمستخدم لمكتبه، خارج صلاحية الإدارة)
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const officeId = Number(body?.officeId);
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  if (!session.isAdmin && session.towerId !== officeId) {
    return NextResponse.json({ error: "لا يمكنك فصل واتساب مكتب آخر" }, { status: 403 });
  }
  await logoutWhatsApp(officeId);
  return NextResponse.json({ ok: true });
}
