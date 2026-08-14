import { NextResponse } from "next/server";
import { guardOwner } from "@/lib/guard";
import { readMeter, flush } from "@/app/api/_lib/egressMeter";

export const dynamic = "force-dynamic";

// قراءةُ عدّاد النقل الصادر — لمالك النظام (طلبُ محمد 2026-08-15: «نفّذ قياس النقل»).
//
// السؤالُ الذي يُجيب عنه: فاتورةُ Railway تقول إنّ **النقل ٣٣٪** من الكلفة (٥٫٣١ غيغا في
// يومَين، مقابل ٥٫٤٧ غيغا في **الشهر** على أزور قبل التحويل) — **ولا تقول من أين**.
// فهذا يفصّله بالمسار: أهو وسيطُ لوحة الساس (المشتبهُ الأوّل)، أم ملفّاتُ الواجهة، أم
// مسارُ API بعينه؟ ولا يُصلَح شيءٌ على ظنٍّ قبل أن يقول الرقمُ كلمتَه.
//
// 🔑 وأهمُّ سطرٍ في الجواب `api:sas4/token`: هذا النداءُ **لا يقع إلّا حين يفشل العثورُ على
//    العامل المحلّيّ**، فعددُه مقياسُ فشلِ الجسّ حرفيّاً. وبعد إصلاح الخانق في هذه الدفعة
//    يجب أن يهبط إلى ما يقارب الصفر من حاسبات المكاتب (ويبقى للهواتف — وهو صحيح).
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;

  await flush().catch(() => {}); // نُثبّت ما في الذاكرة أوّلاً فيكون المعروضُ كاملاً
  const m = await readMeter();

  const rows = Object.entries(m.buckets)
    .map(([bucket, v]) => ({
      bucket,
      bytes: v.bytes,
      count: v.count,
      mb: Math.round((v.bytes / 1048576) * 100) / 100,
      avgKb: v.count ? Math.round((v.bytes / v.count / 1024) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);
  // نسبةُ كلّ دلوٍ من المقيس — وهي ما يُقارَن بحصص الفاتورة
  for (const r of rows as Array<(typeof rows)[number] & { pct?: number }>) {
    r.pct = totalBytes ? Math.round((r.bytes / totalBytes) * 1000) / 10 : 0;
  }

  return NextResponse.json({
    since: m.since,          // متى بدأ القياس (يتراكم عبر النشرات — لا يُصفَّر بإعادة التشغيل)
    at: m.at,                // آخرُ تثبيتٍ في القاعدة
    totalMb: Math.round((totalBytes / 1048576) * 100) / 100,
    rows,
    // ⚠️ صدقُ الرقم: هذا يقيس ما يمرّ **بالمسارات المُثبَّت عليها العدّاد** (وسيطُ الساس
    //    ونداءُ رمزه) لا كلَّ نقل الموقع. فنسبتُه إلى إجمالي Railway هي المقصودة: إن كان
    //    الساسُ غيغاباتٍ من أصل ٥٫٣١ فقد ثبتت التهمة، وإن كان ميغاباتٍ فالمذنبُ غيرُه.
    note: "مقيسٌ على وسيط الساس ونداء رمزه — يُقارَن بإجمالي Railway لتحديد الحصّة",
  });
}
