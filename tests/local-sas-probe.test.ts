import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══ بلاغُ محمد 2026-08-15: «الساس ليس محلّيّاً لأنّه يتأخّر · والطابعات تطبع على السحابة» ═══
//
// الشكويان علّةٌ واحدة: خانقٌ **مشتركٌ بين كلّ مكوّنات التبويب** كان يردّ «لا عامل محلّيّ»
// **بلا أن يجسّ** طيلة ١٥ ثانية بعد أيّ جسّةٍ من أيّ مكوّن. فيسقط الوصلُ إلى الطابور
// السحابيّ (٥ ثوانٍ) وتُحمَّل لوحةُ الساس عبر أمريكا (بطءٌ ونقلٌ مدفوع) — والعاملُ يعمل.
//
// والحرسُ هنا على المبدأ لا على الصياغة: **مَن يسأل ينتظر جواباً حقيقيّاً، ولا يُصرَف
// بجوابٍ قديم؛ ولا يُتّخذ قرارُ محلّيّ/سحابيّ قبل أن تنتهيَ أوّلُ جسّة.**

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** الكودُ بلا تعليقات — فالتعليقاتُ هنا **تقتبس العلّةَ القديمة** لتشرحها، ولو فُحص النصُّ
 *  كاملاً لأدان الشرحُ نفسَه الإصلاحَ. والحرسُ على ما يُنفَّذ لا على ما يُقرأ. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const PROBE = "src/components/localSas.ts";

describe("جسُّ العامل المحلّيّ — خانقٌ لا يخنق", () => {
  test("🔑 الجسّةُ الجاريةُ تُشارَك: السائلُ الثاني ينضمّ ولا يُصرَف بـ\"\"", () => {
    const src = read(PROBE);
    assert.match(src, /let inflight: Promise<string> \| null/, "لا مشاركةَ لجسّةٍ جارية");
    assert.match(src, /if \(inflight\) return inflight/, "السائلُ الثاني لا ينضمّ للجسّة الجارية");
  });

  test("⛔ لا يعود الخانقُ القديم: منعٌ ١٥ ثانيةً بختمٍ قبل الانتظار", () => {
    const src = code(PROBE);
    assert.equal(/lastProbe/.test(src), false, "عاد الخانقُ القديم (lastProbe)");
    assert.equal(/< 15000|< 15_000/.test(src), false, "عادت نافذةُ المنع ١٥ ثانية");
    // والتهدئةُ الباقيةُ **قصيرةٌ ويمكن تجاوزُها** — فهي تهدئةٌ لا منع
    assert.match(src, /FAIL_COOLDOWN_MS = 5000/, "التهدئةُ ليست قصيرة");
    assert.match(src, /!opts\?\.wait && Date\.now\(\) - lastFail < FAIL_COOLDOWN_MS/,
      "التهدئةُ غيرُ قابلةٍ للتجاوز — فهي خانقٌ من جديد");
  });

  test("♾️ إعادةُ المحاولة بلا استسلام (كان يقف بعد ١٥ محاولة ≈ ٥ دقائق)", () => {
    const src = code(PROBE);
    assert.equal(/\+\+tries < 15|tries < 15/.test(src), false, "عاد سقفُ المحاولات");
    assert.match(read(PROBE), /RETRY_MAX_MS = 60_000/, "لا سقفَ لفاصل إعادة المحاولة");
    assert.match(src, /delay = Math\.min\(delay \* 2, RETRY_MAX_MS\)/, "لا تباطؤَ تصاعديّ");
    assert.match(src, /visibilitychange/, "عودةُ التبويب لا تُطلق جسّةً فوريّة");
  });

  test("🏁 سباقُ صفحة الساس: لا قرارَ قبل استقرار الجسّ", () => {
    const src = read(PROBE);
    assert.match(src, /settled/, "لا رايةَ استقرارٍ في الجسّ");
    const page = read("src/app/(app)/subscribers/sas4/page.tsx");
    assert.match(page, /useLocalSasProbe\(\)/, "الصفحةُ لا تقرأ حالةَ الاستقرار");
    assert.match(page, /if \(!settled\) return;/, "الصفحةُ تختار المسارَ قبل أن تعرف — وهو السباق");
    assert.match(page, /\[towerId, panelId, localBase, settled\]/, "الاستقرارُ ليس في تبعيّات الأثر");
  });

  test("🖨️ زرُّ الطباعة ينتظر جواباً حقيقيّاً لا جواباً قديماً", () => {
    const btn = read("src/components/PrintNowButton.tsx");
    assert.match(btn, /localSasBase\(\{ wait: true \}\)/, "الزرُّ يقبل «لا عامل» من التهدئة");
  });

  test("📍 وموضعُ الملفّ يمنع هدمَ جلسات الواتساب (UI_ONLY)", () => {
    // `src/lib` خارجَ UI_ONLY في workerRestart.ts ⇒ أيُّ تغييرٍ فيه يُعيد تشغيل الحاسبات السبع
    // ويهدم جلساتِ الواتساب. وهذا ملفُّ متصفّحٍ خالصٌ لا يستورده العامل.
    const worker = read("src/lib/workerRestart.ts");
    assert.match(worker, /\^src\\\/components\\\//, "components ليست في UI_ONLY");
    assert.ok(fs.existsSync(path.join(ROOT, PROBE)), "الوحدةُ ليست في src/components");
    // ولا مستهلكَ باقٍ على النسخة القديمة
    for (const f of ["src/components/PrintNowButton.tsx", "src/components/StatCards.tsx",
                     "src/components/ActivationModal.tsx", "src/app/(app)/subscribers/sas4/page.tsx"]) {
      assert.equal(/@\/lib\/localSas/.test(read(f)), false, `${f} ما زال على النسخة القديمة`);
    }
  });
});

describe("عطبُ الإنتاج: permission denied for table agents", () => {
  test("🔴 العمودُ المفقودُ مُنِح لدور العامل", () => {
    const g = read("prisma/rls/02-grants.sql");
    assert.match(g, /"odooSlaSendAllowed"/, "العمودُ ما زال خارجَ منح دور العامل");
    // والقارئُ الذي كان يفشل صامتاً
    const sync = read("src/lib/odooSync.ts");
    assert.match(sync, /select: \{ odooSlaSendAllowed: true \}/, "تغيّر القارئُ — يُراجَع المنح");
    assert.ok(fs.existsSync(path.join(ROOT, "scripts/grant-odoo-sla-col.mjs")), "لا سكربتَ تطبيقٍ على الإنتاج");
  });
});

// (أُزيل عدّادُ النقل الصادر واختباراتُه 2026-09-13 — لا رسومَ نقلٍ على الخادم الذاتيّ)
