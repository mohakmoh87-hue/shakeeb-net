import { NextResponse } from "next/server";
import { runAutoCheckout } from "@/lib/autoCheckout";

export const dynamic = "force-dynamic";
// مهلة أطول: تصدير نسخ الوكلاء وإرسالها بالبريد قد يتجاوز المهلة الافتراضية
export const maxDuration = 60;

// كرون سحابي ليلي (Vercel Cron ~00:15 بغداد) — يعمل على السحابة مستقلاً تماماً عن حواسيب
// المكاتب (فيُنفَّذ ولو كانت كلها مغلقة): بصمة خروج تلقائية للمنسيّين + تنظيف الأرشيف +
// النسخ الاحتياطية اليومية بالبريد (بعلامة lastBackupDate تمنع الازدواج مع مجدول الحاسبة).
// محميّ بـ CRON_SECRET الذي يُضيفه Vercel Cron تلقائياً في ترويسة Authorization.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  const r = await runAutoCheckout();
  // تنظيف الأرشيف: حذف نهائي لبطاقات الأرشيف الأقدم من أسبوع (لا يعتمد على حواسيب المكاتب)
  const { purgeOldArchivedCards } = await import("@/lib/field");
  const purged = await purgeOldArchivedCards().catch(() => 0);
  // النسخ الاحتياطية اليومية لإيميلات الوكلاء — من السحابة حتى مع إغلاق كل الحاسبات
  const { runDailyBackups } = await import("@/lib/backupJob");
  const backups = await runDailyBackups().catch(() => ({ total: 0, sent: 0, failed: 0 }));
  return NextResponse.json({ ok: true, closed: r.closed, purgedArchive: purged, backups });
}
