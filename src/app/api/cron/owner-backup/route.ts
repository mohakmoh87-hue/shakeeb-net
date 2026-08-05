import { NextResponse } from "next/server";
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

  // ===== الضمان: مرّة كل يوم — لا «في الساعة كذا حصراً» (تصحيح 2026-08-05) =====
  // كان الإرسال مشروطاً بمطابقة ساعة بغداد للساعة المضبوطة (23:55). لكن GitHub يؤخّر
  // جدولة المستودعات المجانية ساعات، فيقع التشغيل في ساعة أخرى فيتخطّى الإرسال **بصمت**
  // ويقول «ليست الساعة». النتيجة: لم تصل نسخة كاملة من 2 آب إلى 5 آب — ثلاث ليالٍ.
  // الآن: مانع الازدواج بيوم بغداد (lastOwnerBackupDate) هو الضامن — أول تشغيل في اليوم
  // يُرسل، ثم لا يُرسل ثانيةً. فتصل النسخة كل يوم مضموناً، وإن تقدّم وقتها أو تأخّر.
  // والوقت المضبوط يبقى تفضيلاً معروضاً في حساب المالك لا شرطاً يمنع الإرسال.

  const r = await sendOwnerFullBackup({ skipDedup: force });
  return NextResponse.json(r);
}
