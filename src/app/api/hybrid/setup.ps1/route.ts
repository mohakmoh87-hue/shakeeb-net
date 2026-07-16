export const dynamic = "force-dynamic";

// سكربت PowerShell لإعداد وكيل شكيب نت على حاسبة المكتب (النظام الهجين — الخيار ب).
// عام (بلا أسرار): رابط قاعدة البيانات يُدخَل يدوياً مرّة واحدة أثناء التشغيل.
// ملاحظة: لا يحتوي السكربت على أي حرف backtick (لتفادي تعارضه مع قالب JS).
const SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$repo = "https://github.com/mohakmoh87-hue/shakeeb-net.git"
$root = Join-Path $env:LOCALAPPDATA "ShakeebNet"
$app  = Join-Path $root "app"

Write-Host "===== اعداد وكيل شكيب نت =====" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $root | Out-Null

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
  $db = Read-Host "الصق رابط قاعدة بيانات Neon (DATABASE_URL)"
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
npm install
npx prisma generate

# 5) التشغيل التلقائي عند دخول ويندوز — عبر مجلد بدء التشغيل (بلا صلاحية مدير)
try {
  $startup = [Environment]::GetFolderPath('Startup')
  $runner  = Join-Path $startup 'ShakeebNetAgent.bat'
  $batLines = @('@echo off', ('cd /d "' + $app + '"'), 'start "" /min cmd /c npx tsx src/worker.ts')
  Set-Content -Encoding ascii -Path $runner -Value $batLines
  Write-Host "سُجّل التشغيل التلقائي عند الاقلاع." -ForegroundColor Green
} catch {
  Write-Host "تعذّر تسجيل التشغيل التلقائي — سيعمل يدوياً." -ForegroundColor Yellow
}

# 6) تشغيل العامل الآن (عملية مستقلة لا تعتمد على مُسجِّل Next)
Start-Process cmd -ArgumentList '/c npx tsx src/worker.ts' -WorkingDirectory $app

Write-Host ""
Write-Host "تم الاعداد بنجاح" -ForegroundColor Green
Write-Host "العامل يعمل الان، وسيبدأ تلقائياً عند تشغيل الحاسبة."
Write-Host "افتح صفحة الموقع وامسح رمز واتساب عند طلبه — وسيختفي اشعار الاعداد تلقائياً."
Read-Host "اضغط Enter للانهاء"
`;

export async function GET() {
  return new Response(SCRIPT, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
