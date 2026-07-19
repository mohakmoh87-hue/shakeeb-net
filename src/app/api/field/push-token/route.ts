import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// تسجيل رمز جهاز FCM للفني (من التطبيق الأصلي) — ليتمكّن الخادم من إيقاظ خدمة التتبع.
// أو مسحه ({token:null}) عند الخروج/إبطال الرمز. العزل: الفني يعدّل صفّه فقط.
const schema = z.object({ token: z.string().min(10).max(4096).nullable() });

export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "رمز غير صحيح" }, { status: 400 });
  await prisma.technician.update({
    where: { id: tech.technicianId },
    data: { fcmToken: parsed.data.token },
  });
  return NextResponse.json({ ok: true });
}
