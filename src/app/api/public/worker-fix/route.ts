import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// سكربت إصلاح تحديث عامل حاسبات المكاتب — يُنزَّل من الموقع مباشرة على حاسبة المكتب
// (حادثة 2026-07-30: مفتاح GitHub القديم مات بعد تدوير الأسرار فتجمّدت الحاسبات على
// كود قديم). عام بلا حراسة: لا يحوي أي سرّ — المفتاح الجديد يُلصق يدوياً عند التشغيل.
// يجد مجلد التطبيق بنفسه، يرفض العمل والعامل شغّال، يضبط العنوان، يتحقق من المفتاح،
// يسحب الكود، ويعيد تشغيل العامل.
const SCRIPT_LINES = [
  "@echo off",
  "chcp 65001>nul",
  "title اصلاح تحديث عامل SHAKEEB",
  "echo.",
  "echo جارٍ البحث عن مجلد التطبيق على هذه الحاسبة...",
  'set "APP="',
  'for %%D in ("%USERPROFILE%\\Desktop" "%USERPROFILE%\\Documents" "%USERPROFILE%" "C:\\" "D:\\") do (',
  '  if not defined APP for /f "delims=" %%i in (\'dir /s /b "%%~D\\worker-loop.cmd" 2^>nul\') do if not defined APP set "APP=%%~dpi"',
  ")",
  "if not defined APP (",
  "  echo [خطأ] لم اجد مجلد التطبيق على هذه الحاسبة — هل العامل منصب هنا؟",
  "  pause",
  "  exit /b 1",
  ")",
  'echo وجدته: %APP%',
  'cd /d "%APP%"',
  ":waitclose",
  'netstat -ano | findstr ":47615" | findstr "LISTENING" >nul 2>&1',
  "if not errorlevel 1 (",
  "  echo.",
  "  echo العامل لا يزال شغالا — اغلق نافذته السوداء اولا ثم اضغط اي زر هنا.",
  "  pause>nul",
  "  goto waitclose",
  ")",
  "echo.",
  "echo ============================================",
  "echo    اصلاح تحديث عامل SHAKEEB",
  "echo ============================================",
  "echo.",
  "set /p TOKEN=الصق مفتاح GitHub الجديد هنا ثم Enter: ",
  'if "%TOKEN%"=="" ( echo [خطأ] لم تدخل مفتاحا. & pause & exit /b 1 )',
  "echo.",
  "echo [1/3] ضبط عنوان المستودع بالمفتاح الجديد...",
  'git remote set-url origin "https://%TOKEN%@github.com/mohakmoh87-hue/shakeeb-net.git"',
  "echo [2/3] فحص المفتاح مع GitHub...",
  "git fetch --quiet",
  "if errorlevel 1 (",
  "  echo.",
  "  echo [فشل] GitHub رفض المفتاح — تاكد من نسخه كاملا وان صلاحيته Contents: Read",
  "  echo على مستودع shakeeb-net، ثم شغل هذا الملف من جديد.",
  "  pause",
  "  exit /b 1",
  ")",
  "echo        المفتاح صحيح، تم قبوله.",
  "echo [3/3] سحب اخر كود...",
  "git pull --ff-only",
  "echo.",
  "echo ============================================",
  "echo    تم! جارٍ تشغيل العامل من جديد...",
  "echo ============================================",
  'start "SHAKEEB Worker" "%APP%worker-loop.cmd"',
  "timeout /t 5 >nul",
  "exit /b 0",
] as const;

export async function GET() {
  // أسطر CRLF إلزامية لملفات cmd على ويندوز
  const body = SCRIPT_LINES.join("\r\n") + "\r\n";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/octet-stream; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fix-shakeeb.cmd"',
      "Cache-Control": "no-store",
    },
  });
}
