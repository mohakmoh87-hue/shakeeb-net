import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exportFullSystemBackupTo } from "@/lib/backup";
import { claimOwnerBackupDay, finalizeOwnerBackupDay } from "@/lib/backupJob";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

// ═════ نسخةُ النظام الكاملة إلى إيميل المالك — الموقعُ يُجهّز ومهمّةُ GitHub تُرسل ═════
// تاريخُ العلّة (2026-08-20): سرُّ APP_BASE_URL كان يشير إلى أزور القديمة فكانت النسخُ
// تنفجر هناك منذ 16 آب؛ وبعد تصويب العنوان انكشف أنّ **Railway يحجب SMTP نهائيّاً على
// خطّة Hobby** (ENETUNREACH ثمّ Connection timeout) — فالإرسالُ من الموقع مستحيلٌ بنيويّاً.
// ⇒ قُلبت الأدوار: مهمّةُ GitHub الساعيّة تنزّل الملفَّ من هنا (بثّاً — فلا يقطع وسيطُ
// Railway الردَّ لصمته) وتُرسله بالبريد من عامل GitHub (SMTP مسموحٌ هناك)، ثمّ تعود
// فتؤكّد بـconfirm=1 فيُختَم اليوم. عهدةُ الحجز تَبلى بعد ٣٠ دقيقة فأيُّ موتٍ صامتٍ
// (قتلُ حاويةٍ وسطَ البثّ، فشلُ بريدٍ بلا تأكيد) يعالج نفسَه في الدورة التالية.
// محميّ بـCRON_SECRET، و?force=1 يتجاوز مانعَ «مرّة في اليوم» (إرسال فوري).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const todayKey = baghdadDayKey(new Date());

  // مهمّةُ GitHub أرسلت البريدَ بنجاح ⇒ ختمُ اليوم الصريح
  if (url.searchParams.get("confirm") === "1") {
    const ok = await finalizeOwnerBackupDay(todayKey);
    if (ok) console.log(`[backup] ✅ نسخة المالك الكاملة أُكّد وصولُها بالبريد (${todayKey})`);
    else console.error(`[backup] ⚠️ تأكيدُ نسخةٍ بلا عهدةٍ قائمة (${todayKey}) — تجاهُل`);
    return NextResponse.json({ confirmed: ok });
  }

  if (url.searchParams.get("download") !== "1") {
    return NextResponse.json(
      { error: "استخدم ?download=1 — الإرسالُ من الموقع أُلغي لأنّ Railway يحجب SMTP على خطّة Hobby" },
      { status: 400 },
    );
  }

  // إيميلُ المالك يُبلَّغ للمُرسِل (مهمّة GitHub) في ترويسة — يُفحَص قبل أيّ حجز
  const emailRow = await prisma.systemSetting.findFirst({ where: { type: "ownerBackupEmail" } });
  const to = emailRow?.value?.trim();
  if (!to) return NextResponse.json({ error: "لا يوجد إيميل نسخة المالك" }, { status: 409 });

  if (!force) {
    const c = await claimOwnerBackupDay(todayKey);
    if (!c.claimed) return new NextResponse(null, { status: 204, headers: { "x-backup-skip": "already-sent" } });
  }

  const filename = `shakeeb-full-${new Date().toISOString().slice(0, 10)}.json.gz`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      exportFullSystemBackupTo((chunk) => controller.enqueue(new Uint8Array(chunk)))
        .then((r) => {
          console.log(`[backup] 📤 بُثّت نسخة المالك للتنزيل (${r.tableCount} جدولاً، ${r.rowCount} صفّاً) — بانتظار تأكيد البريد`);
          controller.close();
        })
        .catch((e) => {
          // قطعُ البثّ يُفشل تنزيلَ المهمّة (gzip -t يرفض الملفَّ المبتور) والعهدةُ تَبلى فتُعاد المحاولة
          console.error(`[backup] 🔴 فشل بثُّ نسخة المالك: ${e instanceof Error ? e.message : e}`);
          controller.error(e);
        });
    },
  });
  return new NextResponse(stream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-backup-filename": filename,
      "x-backup-to": to,
      "cache-control": "no-store",
    },
  });
}
