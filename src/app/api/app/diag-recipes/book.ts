// ═════ 🩺 كتابُ لهجات أجهزة البور (طلبُ محمد 2026-11-23) ═════
//
// كانت لهجةُ كلّ جهازٍ مدفونةً في `main.dart`: المساراتُ والتعميةُ والعنوانُ وعلامةُ
// القراءة. فكلُّ جهازٍ جديدٍ يختلف كان يعني **حزمةً جديدةً ينصّبها كلُّ مشترك**.
// صارت بياناتٍ هنا: إصلاحُ جهازٍ = تعديلُ وصفةٍ ودفعةٌ إلى `main`.
//
// 📍 وموضعُ الملفّ مقصود: `src/app/` ضمن `UI_ONLY` في `workerRestart.ts` — فتعديلُ
//    لهجةٍ لا يُعيد تشغيل حاسبات المكاتب ولا يُسقط جلساتِ واتساب.
//
// ⚠️ لا تُضف وصفةً إلّا ومعها بصمةُ جهازٍ حقيقيّةٍ من سجلّ الفحص. والترتيبُ يُقرأ من
//    أعلى لأسفل بعد تقديم ما طابق الطراز، فضع المؤكّدَ قبل المحتمل.

export type DiagRecipe = {
  id: string;
  model?: string; // تعبيرٌ نمطيٌّ يُطابَق بسطر الطراز المقروء من صفحة الجهاز
  host?: string;
  jar: Record<string, string>;
  auth: "none" | "md5+sha" | "sha" | "md5";
  token?: string;
  tokenRe?: string;
  login: string;
  form: string; // {user} {pass} {pass64} {token}
  optic: string;
  user: string;
  pass: string;
  anchor?: string;
  rx?: string;
  window?: number;
  min?: number;
  max?: number;
  unescape?: boolean;
};

export type DiagBook = {
  v: number;
  hosts: string[];
  budgetMs: number;
  recipes: DiagRecipe[];
};

const HUAWEI = {
  jar: { "body:Language:english:id": "-1" },
  token: "/asp/GetRandCount.asp",
  login: "/login.cgi",
  form: "UserName={user}&PassWord={pass64}&x.X_HW_Token={token}",
  optic: "/html/amp/opticinfo/opticinfo.asp",
  user: "telecomadmin",
  pass: "admintelecom",
  anchor: "AMP.Optic",
} as const;

export const DIAG_BOOK: DiagBook = {
  v: 1,
  hosts: ["192.168.100.1"],
  budgetMs: 20000,
  recipes: [
    // 🎯 مقيسةٌ على جهاز محمد 2026-11-22: هذا الطرازُ **لا يعمّي شيئاً**، والوصفةُ
    //    مأخوذةٌ حرفاً بحرفٍ من كود صفحة دخوله. فكعكةُ `Cookie` هي النصُّ نفسُه.
    {
      ...HUAWEI,
      id: "hw-plain",
      model: "HS8546",
      jar: { Cookie: "body:Language:english:id=-1" },
      auth: "none",
    },
    // الوصفةُ القائمةُ منذ البداية والعاملةُ على HS8145V5 و HG8245Q2
    { ...HUAWEI, id: "hw-md5sha", auth: "md5+sha" },
    { ...HUAWEI, id: "hw-plain-any", jar: { Cookie: "body:Language:english:id=-1" }, auth: "none" },
    { ...HUAWEI, id: "hw-sha", auth: "sha" },
    { ...HUAWEI, id: "hw-md5", auth: "md5" },
  ],
};

// ✅ حارسُ الكتاب: يمنعني من نشر لهجةٍ ناقصةٍ تُعطّل الفحصَ عند كلّ مشترك.
export function validateBook(b: DiagBook): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(b.v) || b.v < 1) errs.push("رقمُ النسخة غيرُ صالح");
  if (!Array.isArray(b.hosts) || b.hosts.length === 0) errs.push("لا عناوينَ افتراضيّة");
  if (!(b.budgetMs >= 5000 && b.budgetMs <= 60000)) errs.push("ميزانيّةُ الوقت خارج المدى");
  if (!Array.isArray(b.recipes) || b.recipes.length === 0) errs.push("لا وصفات");
  if (b.recipes.length > 24) errs.push("وصفاتٌ أكثرُ من اللازم");
  const ids = new Set<string>();
  for (const r of b.recipes ?? []) {
    const at = `وصفة «${r.id}»`;
    if (!r.id || ids.has(r.id)) errs.push(`${at}: معرّفٌ مفقودٌ أو مكرّر`);
    ids.add(r.id);
    for (const k of ["login", "form", "optic", "user", "pass"] as const) {
      if (!r[k]) errs.push(`${at}: الحقل ${k} مفقود`);
    }
    if (!["none", "md5+sha", "sha", "md5"].includes(r.auth)) errs.push(`${at}: تعميةٌ مجهولة`);
    if (r.auth !== "none" && !r.token) errs.push(`${at}: التعميةُ تحتاج مسارَ رمز`);
    if (!r.jar || typeof r.jar !== "object") errs.push(`${at}: كعكاتٌ مفقودة`);
    for (const p of [r.login, r.optic, r.token]) {
      if (p != null && !p.startsWith("/")) errs.push(`${at}: المسار «${p}» لا يبدأ بشرطة`);
    }
    if (!r.form.includes("{user}")) errs.push(`${at}: النموذجُ بلا {user}`);
    for (const [k, v] of [["model", r.model], ["rx", r.rx]] as const) {
      if (v == null) continue;
      try { new RegExp(v); } catch { errs.push(`${at}: تعبيرُ ${k} غيرُ صالح`); }
    }
    if (r.window != null && (r.window < 40 || r.window > 4000)) errs.push(`${at}: نافذةُ القراءة خارج المدى`);
  }
  return errs;
}
