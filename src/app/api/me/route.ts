import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// بيانات الجلسة الحالية (للواجهة: إظهار الأزرار حسب الصلاحيات)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    fullName: session.fullName,
    isAdmin: session.isAdmin,
    permissions: session.permissions ?? [],
    towerId: session.towerId,
  });
}
