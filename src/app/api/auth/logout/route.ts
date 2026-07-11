import { NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import { runManagerDailyReport } from "@/lib/scheduler";

export async function POST() {
  // عند تسجيل الخروج: أرسل التقرير اليومي لمدير مكتب المستخدم (مرة واحدة يومياً).
  // مستخدم المكتب → مكتبه فقط؛ المدير → كل المكاتب التي لم يُرسل تقريرها اليوم.
  const session = await getSession();
  const officeIds = session && !session.isAdmin && session.towerId != null ? [session.towerId] : undefined;
  // لا نُعطّل تسجيل الخروج بانتظار الإرسال (يعمل في الخلفية)
  void runManagerDailyReport(officeIds, { oncePerDay: true }).catch(() => {});

  await clearSession();
  return NextResponse.json({ ok: true });
}
