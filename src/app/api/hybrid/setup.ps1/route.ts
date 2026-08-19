import { publicOrigin } from "@/lib/publicOrigin";

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
  $extra = ";" + $env:ProgramFiles + "\nodejs;" + $env:ProgramFiles + "\Git\cmd"
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + $extra
}

# 1) Node.js و Git — winget أولاً (الأسرع)، وإن غاب أو فشل نُنزّل المثبّت الرسمي مباشرةً.
#    السبب: ويندوز حديث التنصيب كثيراً ما يأتي بـwinget غير مهيّأ (App Installer قديم) فيفشل
#    التنصيب كلّه بخطأ أحمر. المُنصِّب يجب ألا يعتمد على أداة قد لا تكون موجودة.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function TryWinget($id) {
  if (-not (Have winget)) { return $false }
  try {
    winget install -e --id $id --accept-source-agreements --accept-package-agreements | Out-Null
    RefreshPath
    return $true
  } catch { return $false }
}

# التثبيت الصامت يحتاج صلاحية مدير — بدونها يفشل msiexec بصمت تام. نرفع الصلاحية
# بـRunAs (تظهر نافذة ويندوز الزرقاء «هل تسمح؟» — يضغط المستخدم «نعم») ونُبلّغ برمز الخروج.
function RunElevated($file, $argList) {
  Write-Host "ستظهر نافذة ويندوز تسألك السماح — اضغط (نعم/Yes)." -ForegroundColor Cyan
  $p = Start-Process $file -ArgumentList $argList -Verb RunAs -Wait -PassThru
  return $p.ExitCode
}
# رموز نجاح المثبّتات: 0 نجاح، 3010/1641 نجاح يطلب إعادة تشغيل، وغياب الرمز ليس فشلاً.
# بدونها كان إنذار أحمر كاذب يظهر بعد تثبيت ناجح فيظنّه المستخدم عطلاً.
function BadCode($c) {
  if ($null -eq $c) { return $false }
  return (@(0, 3010, 1641) -notcontains $c)
}

if (-not (Have node)) {
  Write-Host "تثبيت Node.js LTS..." -ForegroundColor Yellow
  TryWinget "OpenJS.NodeJS.LTS" | Out-Null
  if (-not (Have node)) {
    Write-Host "winget غير متاح — التنزيل من nodejs.org مباشرة..." -ForegroundColor Yellow
    try {
      $idx = (iwr -UseBasicParsing "https://nodejs.org/dist/index.json").Content | ConvertFrom-Json
      $ver = ($idx | Where-Object { $_.lts } | Select-Object -First 1).version
      $arch = "x86"
      if ([Environment]::Is64BitOperatingSystem) { $arch = "x64" }
      $msi = Join-Path $env:TEMP ("node-" + $ver + "-" + $arch + ".msi")
      iwr -UseBasicParsing ("https://nodejs.org/dist/" + $ver + "/node-" + $ver + "-" + $arch + ".msi") -OutFile $msi
      Write-Host ("تثبيت Node " + $ver + "...") -ForegroundColor Yellow
      $code = RunElevated "msiexec.exe" @("/i", ('"' + $msi + '"'), "/qn", "/norestart")
      if (BadCode $code) { Write-Host ("مثبّت Node انتهى برمز " + $code) -ForegroundColor Red }
      RefreshPath
    } catch { Write-Host ("تعذّر تثبيت Node تلقائياً: " + $_.Exception.Message) -ForegroundColor Red }
  }
}
if (-not (Have git)) {
  Write-Host "تثبيت Git..." -ForegroundColor Yellow
  TryWinget "Git.Git" | Out-Null
  if (-not (Have git)) {
    Write-Host "winget غير متاح — التنزيل من git-scm.com مباشرة..." -ForegroundColor Yellow
    try {
      $rel = (iwr -UseBasicParsing "https://api.github.com/repos/git-for-windows/git/releases/latest" -Headers @{ "User-Agent" = "ShakeebNet" }).Content | ConvertFrom-Json
      $pat = "*-64-bit.exe"
      if (-not [Environment]::Is64BitOperatingSystem) { $pat = "*-32-bit.exe" }
      $asset = $rel.assets | Where-Object { $_.name -like $pat -and $_.name -notlike "*Portable*" } | Select-Object -First 1
      $exe = Join-Path $env:TEMP $asset.name
      iwr -UseBasicParsing $asset.browser_download_url -OutFile $exe
      Write-Host ("تثبيت " + $asset.name + "...") -ForegroundColor Yellow
      $code = RunElevated $exe @("/VERYSILENT","/NORESTART","/NOCANCEL","/SP-","/SUPPRESSMSGBOXES")
      if (BadCode $code) { Write-Host ("مثبّت Git انتهى برمز " + $code) -ForegroundColor Red }
      RefreshPath
    } catch { Write-Host ("تعذّر تثبيت Git تلقائياً: " + $_.Exception.Message) -ForegroundColor Red }
  }
}
if (-not (Have node) -or -not (Have git)) {
  Write-Host ""
  Write-Host "تعذّر تثبيت المتطلبات تلقائياً (لا اتصال بالانترنت غالباً)." -ForegroundColor Red
  Write-Host "نزّل هذين وثبّتهما بالضغط التالي-التالي ثم اعد لصق امر التنصيب:" -ForegroundColor Yellow
  Write-Host "  Node.js LTS : https://nodejs.org/en/download"
  Write-Host "  Git         : https://git-scm.com/download/win"
  Read-Host "اضغط Enter للانهاء"
  exit 1
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

# 3) الاعدادات (.env) — تنصيب جديد يجلبها بالرمز، ورمز صالح على تنصيب قائم يحدّث
#    رابط القاعدة والشهادة فقط (مع الحفاظ على بقية الاسطر) — وهي آلية تبديل القاعدة رسمياً
$envFile = Join-Path $app ".env"
$cfg = $null
if ($env:INSTALL_TOKEN) {
  Write-Host "جلب الإعدادات برمز التنصيب..." -ForegroundColor Yellow
  try {
    $cfg = iwr -UseBasicParsing "__ORIGIN__/api/hybrid/install-config?token=$($env:INSTALL_TOKEN)" | ConvertFrom-Json
  } catch { Write-Host "تعذر جلب الاعدادات بالرمز (قد يكون منتهيا)." -ForegroundColor Red }
}
if (-not (Test-Path $envFile) -and (-not $cfg -or -not $cfg.databaseUrl)) {
  Write-Host "توقف التنصيب: الرمز غير صالح او منتهي الصلاحية (صالح 30 دقيقة ولمرة واحدة)." -ForegroundColor Red
  Write-Host "ولد امر تنصيب جديدا من: حسابات المدير - (تنصيب حاسبة مكتب)." -ForegroundColor Yellow
  Read-Host "اضغط Enter للانهاء"
  exit 1
}
if ($cfg -and $cfg.databaseUrl) {
  # إزالة channel_binding=require (يسبّب فشل اتصال مع سائق pg على بعض الإصدارات)
  $db = ($cfg.databaseUrl -replace '&channel_binding=require','') -replace '\?channel_binding=require&','?'
  $db = $db.Trim()
  # الاحتفاظ بكل الاسطر القائمة (AUTH_SECRET/MACHINE_ID/اعدادات اضافية) عدا الرابط والشهادة
  $keep = @()
  if (Test-Path $envFile) {
    $keep = @(Get-Content $envFile | Where-Object { $_ -and $_ -notmatch '^(DATABASE_URL|DB_SSL_CA_B64)=' })
  }
  if (-not ($keep | Where-Object { $_ -match '^AUTH_SECRET=' })) {
    $chars = (48..57) + (65..90) + (97..122)
    $keep += ("AUTH_SECRET=" + (-join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })))
  }
  if (-not ($keep | Where-Object { $_ -match '^RUN_WORKER=' })) { $keep += "RUN_WORKER=1" }
  # ═════ مُعرِّفٌ ثابتٌ للجهاز — لا عشوائيٌّ لكلّ تنصيب (طلبُ محمد 2026-08-19) ═════
  # «التنصيبُ يعطي حاسبتَين»: كان [guid]::NewGuid يولّد مُعرِّفاً جديداً لكلّ تنصيبٍ بلا env
  # سابق ⇒ تنصيبان على نفس الجهاز = صفّان. الآن يُؤخَذ MachineGuid الثابتُ من سجلّ ويندوز
  # (ثابتٌ ما دام الويندوز مثبّتاً) ⇒ إعادةُ التنصيب على نفس الجهاز تُعيد المُعرِّفَ نفسَه
  # فتُحدّث الصفَّ القائمَ ولا تُنشئ ثانياً. والاحتياطُ عشوائيٌّ إن تعذّرت قراءةُ السجلّ.
  # 🔒 والحاسباتُ القائمةُ غيرُ متأثّرة: يُحفَظ MACHINE_ID الموجودُ في env دائماً (الشرطُ أعلاه).
  if (-not ($keep | Where-Object { $_ -match '^MACHINE_ID=' })) {
    $mid = try { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid } catch { $null }
    if (-not $mid) { $mid = [guid]::NewGuid().ToString() }
    $keep += ("MACHINE_ID=" + $mid)
  }
  $lines = @(("DATABASE_URL=" + $db))
  if ($cfg.caB64) { $lines += ("DB_SSL_CA_B64=" + $cfg.caB64) }
  $lines += $keep
  Set-Content -Encoding utf8 -Path $envFile -Value $lines
  Write-Host "حُدّثت اعدادات الاتصال بقاعدة البيانات." -ForegroundColor Green
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
  const origin = publicOrigin(request);
  const script = SCRIPT.replace(/__ORIGIN__/g, origin);
  return new Response(script, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
