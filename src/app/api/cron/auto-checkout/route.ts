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

  // ===== تقسيم العمل إلى خطوات قصيرة (تشخيص 2026-08-05) =====
  // بوابة Azure تقطع أي طلب يتجاوز ~240 ثانية. وكان هذا المسار ينفّذ كل شيء في
  // نداء واحد: إغلاق البصمات + تنظيف الأرشيف + النسخ الاحتياطية + تنبيهات الخطة +
  // مزامنة كل المكاتب. فلمّا كبرت البيانات تجاوز المجموع الأربع دقائق، فصارت البوابة
  // تقطع الطلب ويسقط الكرون بـexit 1 — وتضيع النسخة الاحتياطية والمزامنة بصمت.
  // (سجل GitHub: كل تشغيل يفشل بعد 4m تماماً منذ 1 آب.)
  // الآن: step=list يعطي قائمة المكاتب، وstep=sync&officeId يزامن مكتباً واحداً،
  // وstep=daily ينفّذ المهام غير المزامنة. وبلا step يبقى السلوك القديم (توافق).
  const sp = new URL(request.url).searchParams;
  const step = (sp.get("step") ?? "").trim();

  if (step === "list") {
    const offices = await prisma.tower.findMany({
      where: { isDeleted: false, syncEnabled: "1" },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
    return NextResponse.json({ ok: true, offices });
  }

  if (step === "sync") {
    const officeId = Number(sp.get("officeId"));
    if (!officeId) return NextResponse.json({ error: "officeId مطلوب" }, { status: 400 });
  
  const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
    try {
      const sr = await runOfficeSyncAll(officeId, { notify: false });
      return NextResponse.json({
        ok: true, office: sr.office,
        checked: sr.phase2?.checked ?? 0, activations: sr.phase1?.activations ?? 0,
        phantom: sr.phase1?.phantom ?? 0, error: sr.error ?? null,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }
  const r = await runAutoCheckout({ resetSupport: true }); // المهمة الليلية: أنهِ كل دعم نشط لليوم الجديد
  // تنظيف الأرشيف: حذف نهائي لبطاقات الأرشيف الأقدم من أسبوع (لا يعتمد على حواسيب المكاتب)
  const { purgeOldArchivedCards } = await import("@/lib/field");
  const purged = await purgeOldArchivedCards().catch(() => 0);
  // النسخ الاحتياطية اليومية لإيميلات الوكلاء — من السحابة حتى مع إغلاق كل الحاسبات
  const { runDailyBackups } = await import("@/lib/backupJob");
  const backups = await runDailyBackups().catch(() => ({ total: 0, sent: 0, failed: 0 }));

  // تنبيهات اقتراب/انتهاء اشتراك الوكلاء (7 و3 ويوم، ثم مهلة السماح، ثم الإيقاف)
  const { runPlanWarnings } = await import("@/lib/planWarnings");
  const planWarnings = await runPlanWarnings().catch(() => ({ checked: 0, notified: 0 }));

  // مزامنة SAS ليلية (backstop سحابي): تعمل ولو كانت حواسيب المكاتب مغلقة — لوحات SAS
  // على الإنترنت فتُنفَّذ خادمياً. notify=false: بيانات فقط بلا تقرير (يتفادى ازدواج تقرير
  // المكتب الذي يُرسله المجدول المحلي عند وقت المزامنة). قفل التزامن يمنع أي تعارض.
  const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
  // خطوة daily: كل المهام الليلية عدا المزامنة — تنتهي في ثوانٍ فلا تُقطع
  if (step === "daily") {
    return NextResponse.json({ ok: true, closed: r.closed, purgedArchive: purged, backups, planWarnings });
  }

  const syncOffices = await prisma.tower.findMany({
    where: { isDeleted: false, syncEnabled: "1" },
    select: { id: true },
  }).catch(() => [] as { id: number }[]);
  let synced = 0;
  const syncDetails: { office: string; checked: number; activations: number; phantom: number; verifiedReal: number; error: string | null }[] = [];
  for (const o of syncOffices) {
    try {
      const sr = await runOfficeSyncAll(o.id, { notify: false });
      synced++;
      syncDetails.push({ office: sr.office, checked: sr.phase2?.checked ?? 0, activations: sr.phase1?.activations ?? 0, phantom: sr.phase1?.phantom ?? 0, verifiedReal: sr.phase1?.verifiedReal ?? 0, error: sr.error ?? null });
    } catch (e) { syncDetails.push({ office: String(o.id), checked: 0, activations: 0, phantom: 0, verifiedReal: 0, error: (e as Error).message }); }
  }

  return NextResponse.json({ ok: true, closed: r.closed, purgedArchive: purged, backups, planWarnings, syncedOffices: synced, syncDetails });
}
