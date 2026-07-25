import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOwnerFullBackup } from "@/lib/backupJob";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// إرسال نسخة النظام الكاملة إلى إيميل المالك عند الوقت المضبوط (حساب المالك ← وقت الإرسال).
// يُستدعى كل ساعة من مهمة GitHub المجدولة؛ يُرسل فقط حين تطابق ساعة بغداد الساعة المضبوطة
// (ومرّة واحدة يومياً عبر مانع الازدواج). ?force=1 يتجاوز فحص الوقت والازدواج (إرسال فوري/اختبار).
// محميّ بـCRON_SECRET (نفس نمط بقية مسارات cron).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";

  if (!force) {
    const row = await prisma.systemSetting.findFirst({ where: { type: "ownerBackupTime" } });
    const configured = (row?.value ?? "").trim(); // "HH:MM"
    const wantHour = parseInt(configured.split(":")[0] ?? "", 10);
    if (!Number.isInteger(wantHour)) {
      return NextResponse.json({ ok: true, skipped: "لم يُضبط وقت الإرسال" });
    }
    // ساعة بغداد الحالية (UTC+3)
    const nowHour = new Date(Date.now() + 3 * 3600 * 1000).getUTCHours();
    if (nowHour !== wantHour) {
      return NextResponse.json({ ok: true, skipped: `ليست الساعة (الآن ${nowHour}، المطلوب ${wantHour})` });
    }
  }

  const r = await sendOwnerFullBackup({ skipDedup: force });
  return NextResponse.json(r);
}
