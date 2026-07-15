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
  $chars = (48..57) + (65..90) + (97..122)
  $secret = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  $lines = @(("DATABASE_URL=" + $db), ("AUTH_SECRET=" + $secret), "RUN_WORKER=1")
  Set-Content -Encoding utf8 -Path $envFile -Value $lines
}

# 4) التثبيت والتوليد والبناء
Write-Host "تثبيت المكتبات (قد يستغرق دقائق)..." -ForegroundColor Yellow
npm install
npx prisma generate
npm run build

# 5) التشغيل التلقائي عند دخول ويندوز
$taskName = "ShakeebNetAgent"
$argLine  = '/c cd /d "' + $app + '" ^&^& set RUN_WORKER=1 ^&^& npm start'
$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argLine
$trigger  = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force -RunLevel Highest | Out-Null

# 6) التشغيل الآن
$env:RUN_WORKER = "1"
Start-Process cmd -ArgumentList '/c set RUN_WORKER=1 && npm start' -WorkingDirectory $app

Write-Host ""
Write-Host "تم الاعداد بنجاح" -ForegroundColor Green
Write-Host "الوكيل يعمل الان، وسيبدأ تلقائياً عند تشغيل الحاسبة."
Write-Host "افتح صفحة الموقع وامسح رمز واتساب عند طلبه — وسيختفي اشعار الاعداد تلقائياً."
Read-Host "اضغط Enter للانهاء"
`;

export async function GET() {
  return new Response(SCRIPT, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
