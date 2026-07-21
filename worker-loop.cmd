@echo off
rem ===== غلاف تشغيل عامل SHAKEEB مع التحديث الذاتي =====
rem يعمل بحلقة: سحب آخر كود - تثبيت المكتبات - توليد Prisma - تشغيل العامل.
rem عندما يكتشف العامل تحديثا يخرج بنظافة، فتعيد الحلقة تشغيله بالكود الجديد.
cd /d "%~dp0"
:loop
git pull --ff-only --quiet
call npm install --no-audit --no-fund --loglevel=error
call npx prisma generate
call npx tsx src/worker.ts
rem مهلة قصيرة قبل اعادة التشغيل (تمنع دوران سريع عند فشل متكرر)
timeout /t 10 /nobreak >nul
goto loop
