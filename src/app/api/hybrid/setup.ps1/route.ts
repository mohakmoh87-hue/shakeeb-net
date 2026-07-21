export const dynamic = "force-dynamic";

// سكربت PowerShell لإعداد وكيل SHAKEEB على حاسبة المكتب (النظام الهجين).
// عام (بلا أسرار)، لكنه لا يعمل لتنصيب جديد إلا برمز تنصيب صالح (INSTALL_TOKEN)
// يولَّد من: حسابات المدير ← «تنصيب حاسبة مكتب». لا إدخال روابط يدوياً إطلاقاً.
// ملاحظة: لا يحتوي السكربت على أي حرف backtick (لتفادي تعارضه مع قالب JS).
const SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
# رفع حظر تشغيل السكربتات للعملية الحالية (يمنع خطأ npm.ps1 cannot be loaded)
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch { }
$repo = "https://github.com/mohakmoh87-hue/shakeeb-net.git"
$root = Join-Path $env:LOCALAPPDATA "ShakeebNet"
$app  = Join-Path $root "app"

Write-Host "===== اعداد وكيل SHAKEEB =====" -ForegroundColor Cyan

# تنصيب جديد يتطلب رمز تنصيب مؤقت (يُفشل مبكراً قبل تثبيت أي شيء)
if (-not (Test-Path (Join-Path $app ".env")) -and -not $env:INSTALL_TOKEN) {
  Write-Host "امر تنصيب غير صالح: التنصيب الجديد يتطلب رمزا مؤقتا." -ForegroundColor Red
  Write-Host "ولد امر التنصيب من: حسابات المدير - (تنصيب حاسبة مكتب) والصقه كما هو." -ForegroundColor Yellow
  Read-Host "اضغط Enter للانهاء"
  exit 1
}
New-Item -ItemType Directory -Force -Path $root | Out-Null

# ايقاف اي عامل قديم يعمل الان (لتطبيق التحديث فورا ومنع قفل الملفات اثناء التثبيت)
try {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*worker.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*worker-loop*' -or $_.CommandLine -like '*worker.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }

function Have($c) { return $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
}

# 1) Node.js و Git
if (-not (Have node)) {
  Write-Host "تثبيت Node.js LTS..." -ForegroundColor Yellow
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
  RefreshPath
}
if (-not (Have git)) {
  Write-Host "تثبيت Git..." -ForegroundColor Yellow
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements | Out-Null
  RefreshPath
}

# 2) تنزيل/تحديث كود البرنامج
if (Test-Path (Join-Path $app ".git")) {
  Write-Host "تحديث الكود..." -ForegroundColor Yellow
  git -C $app pull
} else {
  Write-Host "تنزيل الكود..." -ForegroundColor Yellow
  git clone $repo $app
}
Set-Location $app

# 3) الاعدادات (.env) — تُدخَل مرّة واحدة فقط
$envFile = Join-Path $app ".env"
if (-not (Test-Path $envFile)) {
  Write-Host ""
  # رابط قاعدة البيانات: يُجلب حصراً برمز التنصيب المؤقت — لا إدخال يدوي
  $db = ""
  if ($env:INSTALL_TOKEN) {
    Write-Host "جلب الإعدادات برمز التنصيب..." -ForegroundColor Yellow
    try {
      $cfg = iwr -UseBasicParsing "__ORIGIN__/api/hybrid/install-config?token=$($env:INSTALL_TOKEN)" | ConvertFrom-Json
      $db = $cfg.databaseUrl
    } catch { Write-Host "تعذر جلب الاعدادات بالرمز (قد يكون منتهيا)." -ForegroundColor Red }
  }
  if (-not $db) {
    Write-Host "توقف التنصيب: الرمز غير صالح او منتهي الصلاحية (صالح 30 دقيقة ولمرة واحدة)." -ForegroundColor Red
    Write-Host "ولد امر تنصيب جديدا من: حسابات المدير - (تنصيب حاسبة مكتب)." -ForegroundColor Yellow
    Read-Host "اضغط Enter للانهاء"
    exit 1
  }
  # إزالة channel_binding=require (يسبّب فشل اتصال مع سائق pg على بعض الإصدارات)
  $db = ($db -replace '&channel_binding=require','') -replace '\?channel_binding=require&','?'
  $db = $db.Trim()
  $chars = (48..57) + (65..90) + (97..122)
  $secret = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  $machineId = [guid]::NewGuid().ToString()
  $lines = @(("DATABASE_URL=" + $db), ("AUTH_SECRET=" + $secret), "RUN_WORKER=1", ("MACHINE_ID=" + $machineId))
  Set-Content -Encoding utf8 -Path $envFile -Value $lines
}

# 4) التثبيت والتوليد (العامل المستقل لا يحتاج next build)
Write-Host "تثبيت المكتبات (قد يستغرق دقائق)..." -ForegroundColor Yellow
# استدعاء npm.cmd/npx.cmd مباشرةً لتجاوز حظر تشغيل npm.ps1 عبر سياسة PowerShell
& cmd /c "npm install"
& cmd /c "npx prisma generate"
# متصفّح Chromium للواتساب (whatsapp-web.js) — ضروري لظهور رمز QR؛ قد لا ينزّله npm install وحده
Write-Host "تنزيل متصفّح الواتساب (Chromium)..." -ForegroundColor Yellow
& cmd /c "npx puppeteer browsers install chrome"

# 5) التشغيل التلقائي المخفي عند دخول ويندوز — عبر VBScript بمجلد بدء التشغيل (بلا نافذة، بلا صلاحية مدير)
$oldBat = Join-Path ([Environment]::GetFolderPath('Startup')) 'ShakeebNetAgent.bat'
if (Test-Path $oldBat) { Remove-Item $oldBat -Force -ErrorAction SilentlyContinue }
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'ShakeebNetAgent.vbs'
try {
  # الغلاف worker-loop.cmd = حلقة (سحب اخر كود ثم تشغيل العامل): تحديث ذاتي تلقائي بلا زيارة المكتب
  $vbsLines = @('Set sh = CreateObject("WScript.Shell")', ('sh.CurrentDirectory = "' + $app + '"'), 'sh.Run "cmd /c worker-loop.cmd", 0, False')
  Set-Content -Encoding ascii -Path $vbs -Value $vbsLines
  Write-Host "سُجّل التشغيل التلقائي المخفي عند الاقلاع (مع التحديث الذاتي)." -ForegroundColor Green
  # 6) تشغيل العامل الان مخفياً (بلا نافذة يمكن إغلاقها بالخطأ)
  Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
} catch {
  Write-Host "تعذّر التشغيل المخفي — سيعمل بنافذة." -ForegroundColor Yellow
  Start-Process cmd -ArgumentList '/c worker-loop.cmd' -WorkingDirectory $app
}

Write-Host ""
Write-Host "تم الاعداد بنجاح" -ForegroundColor Green
Write-Host "العامل يعمل الان مخفياً، وسيبدأ تلقائياً عند تشغيل الحاسبة (بلا نافذة)."
Write-Host "افتح صفحة الموقع وامسح رمز واتساب عند طلبه — وسيختفي اشعار الاعداد تلقائياً."
Read-Host "اضغط Enter للانهاء"
`;

export async function GET(request: Request) {
  const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
  const script = SCRIPT.replace(/__ORIGIN__/g, origin);
  return new Response(script, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
