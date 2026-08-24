import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ═════ ⚡ منحُ كروم إذنَ الاتّصال بحاسبة المكتب — تلقائيّاً وبلا صلاحيّة مدير ═════
//
// 🔴 **العلّةُ المقيسة (2026-08-23/24)**: كروم أضاف حارسَ «الوصول إلى الشبكة المحلّيّة»،
//   فصار يمنع `https://shakeebnet.com` من نداء `http://127.0.0.1:47615` — أي **يمنع الموقعَ
//   من رؤية عامل المكتب وإن كان يعمل**. ونصُّ المنع من كونسول حاسبة الشهداء حرفيّاً:
//     «blocked by CORS policy: Permission was denied for this request
//      to access the `loopback` address space»
//   فتُحمَّل لوحةُ الساس من أمريكا: **٧٫٩ ميغا لكلّ فتحة · ٦١٣ ميغا يوميّاً · ٢٢٤ سقطةً
//   إلى السحابة كلَّ يوم** — والعاملُ يعمل على بُعد متر.
//
// 🧭 **ولماذا هذا الطريق دون غيره** (كلُّها جُرّبت وسقطت):
//   · الإذنُ اسمُه **«Apps on device»** لا «Local network» — والسماحُ بالثاني لا يفيد.
//   · سياسةُ كروم في السجلّ تحتاج **صلاحيّةَ مدير**: `HKLM` و`HKCU\Software\Policies`
//     كلاهما رُفض لمستخدمٍ عاديّ (ويندوز يحمي فرعَ Policies)، والعاملُ يعمل بحساب موظّف.
//   · ولا سبيلَ في الويب لمنح إذنِ متصفّحٍ ببرمجة — ولو أمكن لسقطت الحمايةُ كلُّها.
//   · وكروم **يعيد كتابةَ ملفّه من ذاكرته عند خروجه** — قِيس بالتجربة: كتابةٌ وهو يعمل تُمحى.
//   ⇒ فالطريقُ الوحيدُ المُثبَت: **الكتابةُ في ملفّ إعداداته وهو مغلق**. وقد جُرّبت على
//     حاسبة محمد في الاتّجاهين: `setting:2` ⇒ صار `denied`، و`setting:1` ⇒ عاد `granted`.
//
// ⏳ **ولا يُغلق العاملُ كرومَ أحد ولا يوقظ أحداً**: ينتظر. وأوّلُ لحظةٍ يكون فيها مغلقاً
//   (إقلاعُ ويندوز صباحاً · استراحة · نهايةُ دوام) يكتب الإذنَ وينتهي الأمرُ للأبد.
//
// 🛡️ وحرّاسُه: لا يكتب وكرومُ الشخصيُّ يعمل · ولا يكتب إن كان الإذنُ ممنوحاً سلفاً · وينسخ
//   الملفَّ قبل أوّل تعديل · ولا يكتب إن لم يفهم بنيةَ الملفّ · ويمسّ **سطرَ نطاقنا وحدَه**.

const ORIGIN = (process.env.SITE_ORIGIN || "https://shakeebnet.com").replace(/\/+$/, "");
/** مفتاحُ كروم للموقع: `https://host:443,*` — والمنفذُ صريحٌ دائماً في هذا الملفّ */
const SITE_KEY = (() => {
  try {
    const u = new URL(ORIGIN);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return `${u.protocol}//${u.hostname}:${port},*`;
  } catch { return "https://shakeebnet.com:443,*"; }
})();
const SITE_JSON = `"${SITE_KEY}":{"setting":1}`;
/** نمطُ «إذنُ نطاقنا داخل هذا الملفّ» — قيمُ المواقع بلا أقواسٍ متداخلةٍ فـ`[^}]*` يكفي */
const SITE_RE = new RegExp(`("${SITE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\{[^}]*"setting":)[0-9]`);

// ⏱️ كلَّ خمس دقائق (طلبُ محمد 2026-08-24): «عمليّةٌ محلّيّةٌ بين العامل والحاسبة».
// وثمنُها لا يُذكَر: الفحصُ الأوّلُ **قراءةُ ملفٍّ محليٍّ** فقط، ولا يُستدعى PowerShell إلّا
// إن كان هناك ملفٌّ ينقصه الإذن. فالحاسبةُ السليمةُ لا تدفع شيئاً سوى قراءةِ ملفّ.
// وفائدتُها: مَن أغلق الإذنَ سهواً يُستردُّ خلال خمس دقائق من أوّل إغلاقٍ لكروم.
const CHECK_MS = 5 * 60 * 1000;

/** أمرُ PowerShell قصير: مساراتُ عمليّات chrome.exe العاملة الآن (بلا صلاحيّاتٍ ولا CIM) */
function runningChromePaths(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command",
        "Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => resolve(err ? [] : String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)),
    );
  });
}

/**
 * أكرومُ **المستخدم** يعمل الآن؟
 * ⚠️ ولا يُخلَط بمتصفّح الواتساب: اسمُ عمليّته `chrome.exe` أيضاً، لكنّه يسكن مخزنَ
 *    puppeteer — فيُستثنى بمساره. وإن تعذّرت القراءةُ نفترض «يعمل» فلا نكتب (الأحوط).
 */
async function userChromeRunning(): Promise<boolean> {
  const paths = await runningChromePaths();
  return paths.some((p) => !/puppeteer|[\\/]\.cache[\\/]/i.test(p));
}

/** ملفّاتُ الإعدادات لكلّ ملفٍّ شخصيٍّ في كروم على هذه الحاسبة */
function preferenceFiles(): string[] {
  const local = process.env.LOCALAPPDATA;
  if (!local) return [];
  const out: string[] = [];
  for (const brand of ["Google\\Chrome", "Google\\Chrome Beta", "Chromium"]) {
    const root = path.join(local, brand, "User Data");
    let entries: string[] = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) {
      const f = path.join(root, e, "Preferences");
      try { if (fs.statSync(f).isFile()) out.push(f); } catch { /* ليس ملفّاً شخصيّاً */ }
    }
  }
  return out;
}

export type Outcome = "already" | "updated" | "added-site" | "added-section" | "unknown-shape" | "error";

/**
 * جراحةُ النصّ وحدَها — بلا قرصٍ ولا عمليّات، فتُختبَر وحدها.
 * ⚠️ ولماذا جراحةُ نصٍّ لا تحليلُ JSON وإعادةُ كتابته: الملفُّ يحمل جلساتِ المستخدم
 *   وإعداداتِه كلَّها (~١١٠ كيلو)، وإعادةُ كتابته بمُحوِّلٍ آخرَ قد تُغيّر تفاصيلَ لا نراها
 *   فيرفضه كروم ويُصفّر الملفَّ الشخصيّ. فنُدخل سطرَنا ونترك كلَّ بايتٍ آخرَ كما هو.
 */
export function applyGrant(text: string): { text: string; how: Outcome } {
  const m = text.match(SITE_RE);
  if (m && m[0].endsWith("1")) return { text, how: "already" }; // ممنوحٌ سلفاً — لا نلمس شيئاً
  if (m) return { text: text.replace(SITE_RE, "$11"), how: "updated" };
  if (text.includes('"loopback_network":{')) {
    return { text: text.replace('"loopback_network":{', `"loopback_network":{${SITE_JSON},`), how: "added-site" };
  }
  if (text.includes('"exceptions":{')) {
    return { text: text.replace('"exceptions":{', `"exceptions":{"loopback_network":{${SITE_JSON}},`), how: "added-section" };
  }
  return { text, how: "unknown-shape" }; // بنيةٌ لا نعرفها ⇒ لا نكتب شيئاً
}

/** يمنح الإذنَ في ملفٍّ شخصيٍّ واحد. لا يكتب إلّا إن لزم، وينسخ قبل أوّل تعديل. */
function grantInFile(file: string): Outcome {
  let s: string;
  try { s = fs.readFileSync(file, "utf8"); } catch { return "error"; }

  const { text: next, how } = applyGrant(s);
  if (how === "already" || how === "unknown-shape") return how;

  try {
    const bak = file + ".shakeeb.bak";
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    fs.writeFileSync(file, next, "utf8");
    return how;
  } catch { return "error"; }
}

let lastReport = "";

async function sweep(): Promise<void> {
  if (process.platform !== "win32") return;
  const files = preferenceFiles();
  if (!files.length) return;

  // كلُّها ممنوحةٌ سلفاً ⇒ لا نستدعي PowerShell أصلاً (فحصٌ صامتٌ رخيص)
  const pending = files.filter((f) => {
    try { const m = fs.readFileSync(f, "utf8").match(SITE_RE); return !(m && m[0].endsWith("1")); } catch { return false; }
  });
  if (!pending.length) return;

  if (await userChromeRunning()) {
    const note = `[chrome-perm] كروم مفتوح — تأجيل منح إذن الاتصال بحاسبة المكتب (${pending.length} ملف)`;
    if (note !== lastReport) { console.log(note); lastReport = note; } // بلا تكرارٍ كلَّ نصف ساعة
    return;
  }

  const done: string[] = [];
  for (const f of pending) {
    const r = grantInFile(f);
    if (r === "updated" || r === "added-site" || r === "added-section") done.push(`${path.basename(path.dirname(f))}:${r}`);
    else if (r === "unknown-shape" || r === "error") done.push(`${path.basename(path.dirname(f))}:${r}`);
  }
  if (done.length) {
    console.log(`[chrome-perm] ✅ مُنح إذنُ ${ORIGIN} للاتصال بحاسبة المكتب — ${done.join(" · ")} (يسري عند فتح كروم القادم)`);
    lastReport = "";
  }
}

/**
 * يبدأ الحارس: فحصٌ عند الإقلاع ثمّ كلَّ نصف ساعة، حتى يُصادف كرومَ مغلقاً فيمنح الإذن.
 * لا يرمي أبداً — فشلُه لا يُعطّل العامل.
 */
export function startChromeLoopbackPermission(): void {
  if (process.platform !== "win32") return;
  const tick = () => { void sweep().catch(() => { /* لا يُعطّل العامل */ }); };
  setTimeout(tick, 15_000); // بعد استقرار الإقلاع
  setInterval(tick, CHECK_MS);
}
