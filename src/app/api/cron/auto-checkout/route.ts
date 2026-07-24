import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

  // مزامنة SAS ليلية (backstop سحابي): تعمل ولو كانت حواسيب المكاتب مغلقة — لوحات SAS
  // على الإنترنت فتُنفَّذ خادمياً. notify=false: بيانات فقط بلا تقرير (يتفادى ازدواج تقرير
  // المكتب الذي يُرسله المجدول المحلي عند وقت المزامنة). قفل التزامن يمنع أي تعارض.
  const { runOfficeSync } = await import("@/lib/subscriptionSync");
  const syncOffices = await prisma.tower.findMany({
    where: { isDeleted: false, syncEnabled: "1" },
    select: { id: true },
  }).catch(() => [] as { id: number }[]);
  let synced = 0;
  const syncDetails: { office: string; checked: number; activations: number; error: string | null }[] = [];
  for (const o of syncOffices) {
    try {
      const sr = await runOfficeSync(o.id, { notify: false });
      synced++;
      syncDetails.push({ office: sr.office, checked: sr.phase2?.checked ?? 0, activations: sr.phase1?.activations ?? 0, error: sr.error ?? null });
    } catch (e) { syncDetails.push({ office: String(o.id), checked: 0, activations: 0, error: (e as Error).message }); }
  }

  return NextResponse.json({ ok: true, closed: r.closed, purgedArchive: purged, backups, syncedOffices: synced, syncDetails });
}
