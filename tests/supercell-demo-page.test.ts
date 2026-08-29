import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// ═════ 🏢 صفحة /supercell — عرضُ بوّابة سوبر سيل (طلب محمد 2026-08-28) ═════
//
// شرطُ محمد بنصّه: «بدون أي تداخل مع الموقع الحي، يكون عملها مستقل تماماً وصفر تدخل».
// هذا الملفُّ يقفل العزلَ نفسَه — فإن استوردت الصفحةُ يوماً كودَ الموقع أو نادت API
// أو قرأت جلسةً، ينكسر الاختبارُ قبل أن يصل شيءٌ للإنتاج.

const ROOT = process.cwd();

describe("🏢 صفحة /supercell معزولةٌ تماماً عن الموقع الحيّ", () => {
  test("المسارُ يقدّم ملفّاً ثابتاً، ويُحجب بـ404 عند إطفاء البوّابة، بلا لمسِ قاعدةٍ أو جلسةِ مستخدم", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/supercell/route.ts"), "utf8");
    assert.ok(route.includes('path.join(process.cwd(), "public", "supercell.html")'),
      "المسارُ لم يعد يقرأ الملفَّ الثابت من public — وDockerfile ينسخها كاملةً لمخرجات standalone");
    // 🔌 حجبُ 404 عند الإطفاء (طلب محمد 2026-08-29): العلَمُ العامُّ الوحيدُ المسموحُ استيرادُه
    assert.ok(route.includes("getPortalEnabled") && /status:\s*404/.test(route),
      "بوّابةُ /supercell لم تعد تُحجب بـ404 عند إطفاء المالك");
    // صفرُ تدخّل بالمستأجرين: لا Prisma مباشرة ولا جلسةَ مستخدمٍ ولا حارسٍ — علَمٌ عامٌّ فقط
    assert.ok(!/prisma|getSession|guard\(/.test(route), "المسارُ يلمس القاعدةَ مباشرةً أو جلسةَ المستخدم — انكسر العزل");
    // الاستيرادُ الوحيدُ المسموحُ من كود الموقع هو علَمُ البوّابة (appConfig) — لا سواه
    const imports = [...route.matchAll(/from "(@\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(imports, ["@/lib/appConfig"], "المسارُ يستوردُ من كود الموقع أكثرَ من علَم البوّابة — انكسر العزل: " + JSON.stringify(imports));
    assert.ok(route.includes("noindex"), "الصفحةُ بلا noindex — عرضٌ تسويقيٌّ لا يُفهرَس");
  });

  test("الملفُّ الثابتُ موجودٌ، وهميُّ البيانات، وبلا أيّ نداءِ شبكة", () => {
    const p = path.join(ROOT, "public/supercell.html");
    assert.ok(fs.existsSync(p), "public/supercell.html غيرُ موجود — المسارُ سيعيد 500");
    const html = fs.readFileSync(p, "utf8");
    assert.ok(html.startsWith("<!doctype html>"), "الملفُّ بلا هيكل مستند كامل");
    assert.ok(html.includes("بيانات وهمية"), "وسمُ «بيانات وهمية» ضاع — قد تُقرأ الصفحةُ حقيقيّةً");
    assert.ok(html.includes('name="robots" content="noindex'), "ميتا noindex ضاعت من الملفّ");
    // 🔄 (خطة محمد 2026-08-28) «ربط الصفحتين معاً لأرى كيف تمرّ الطلبات»: صار للصفحة
    //    نداءُ شبكةٍ واحدٌ مسموح — جسرُ العرض /api/demo/portal **حصراً**، ولا سواه أبداً.
    assert.ok(!/XMLHttpRequest/.test(html), "ظهر XMLHttpRequest — النداءُ الوحيدُ المسموح جسرُ العرض عبر fetch");
    const apiRefs = html.match(/\/api\/[a-z0-9/-]*/g) ?? [];
    assert.ok(apiRefs.length > 0 && apiRefs.every((u) => u === "/api/demo/portal"),
      "الصفحةُ تنادي مساراً غيرَ جسر العرض /api/demo/portal — انكسر العزل: " + JSON.stringify([...new Set(apiRefs)]));
  });

  test("حارسُ الدخول يستثني /supercell — تفتحها الشركةُ بلا حساب", () => {
    const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    assert.ok(/PUBLIC_PATHS = \[[^\]]*"\/supercell"/.test(proxy),
      "/supercell سقطت من المسارات العامّة — الزائرُ سيُحوَّل إلى /login");
  });
});

// ═════ 📱 صفحة /app — معاينةُ تطبيق المشترك «كابينة» (Flutter كامل، 2026-08-29) ═════
// صار /app غلافاً رقيقاً يضمّن بناءَ Flutter الثابت من /kabina-web في iframe (كلُّ التطبيق:
// شاشاتٌ + فحص + تنقّل). نفسُ شرط «صفر تدخل»: الغلافُ خاملٌ — لا قاعدةَ ولا جلساتٍ ولا نداءَ
// API — والقفلُ هنا يمنع أيَّ تسرّبٍ قبل الإنتاج، ويثبّت أنّ /kabina-web عامٌّ (وإلّا انكسر الـiframe).
describe("📱 صفحة /app (تطبيق المشترك Flutter) معزولةٌ تماماً", () => {
  test("المسارُ ثابتٌ بلا استيرادٍ من كود الموقع، والغلافُ خاملٌ يضمّن /kabina-web، والحارسُ يفتح الاثنين", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/app/route.ts"), "utf8");
    assert.ok(route.includes('path.join(process.cwd(), "public", "subscriber-app.html")'),
      "المسارُ لا يقرأ الملفَّ الثابت من public");
    assert.ok(!/from "@\//.test(route) && !/prisma|getSession|guard\(/.test(route),
      "مسارُ /app صار يلمس كودَ الموقع أو القاعدة — انكسر العزل");
    const p = path.join(ROOT, "public/subscriber-app.html");
    assert.ok(fs.existsSync(p), "public/subscriber-app.html غيرُ موجود — المسارُ سيعيد 500");
    const html = fs.readFileSync(p, "utf8");
    assert.ok(html.startsWith("<!doctype html>"), "الملفُّ بلا هيكل مستند كامل");
    assert.ok(html.includes('name="robots" content="noindex'), "ميتا noindex ضاعت");
    assert.ok(html.includes("بيانات وهمية"), "وسمُ «بيانات وهمية» ضاع — قد تُقرأ الصفحةُ حقيقيّةً");
    // البنيةُ الجديدة: يضمّن بناءَ Flutter الثابت من /kabina-web في iframe (لا محتوى بيانات في الغلاف)
    assert.ok(/<iframe/i.test(html) && html.includes("/kabina-web/"),
      "/app لم يعد يضمّن بناءَ Flutter من /kabina-web — انكسرت المعاينة");
    // عزلٌ أقوى من السابق: الغلافُ خاملٌ تماماً — لا XHR ولا أيّ نداءِ API (الكودُ كلُّه في بناء Flutter المعزول)
    assert.ok(!/XMLHttpRequest/.test(html), "ظهر XMLHttpRequest في /app — الغلافُ يجب أن يكون خاملاً");
    const apiRefs = html.match(/\/api\/[a-z0-9/-]*/g) ?? [];
    assert.equal(apiRefs.length, 0,
      "غلافُ /app ينادي مسارَ API — يجب أن يكون خاملاً تماماً: " + JSON.stringify([...new Set(apiRefs)]));
    const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    assert.ok(/PUBLIC_PATHS = \[[^\]]*"\/app"/.test(proxy), "/app سقطت من المسارات العامّة");
    // بناءُ Flutter (iframe) يجب أن يكون عامّاً أيضاً وإلّا حُوِّل إلى /login للزائر غير المسجَّل
    assert.ok(/PUBLIC_PATHS = \[[^\]]*"\/kabina-web"/.test(proxy),
      "/kabina-web سقطت من المسارات العامّة — الـiframe سيُحوَّل إلى /login للزائر");
  });
});

// ═════ 🌉 جسرُ العرض /api/demo/portal — مؤقّتٌ ومعزولٌ (خطة محمد 2026-08-28) ═════
// «حالياً أربط الصفحتين لأرى كيف تمرّ الطلبات، ولاحقاً الربطُ مع إدارة الفنيين».
describe("🌉 جسرُ العرض التجريبيّ معزولٌ ومسقوف", () => {
  test("ذاكرةُ عمليةٍ فقط — لا قاعدةَ ولا جلسات ولا استيرادَ من كود الموقع، وبسقوفٍ وحدِّ إرسال", () => {
    const r = fs.readFileSync(path.join(ROOT, "src/app/api/demo/portal/route.ts"), "utf8");
    assert.ok(!/from "@\//.test(r), "الجسرُ صار يستورد من كود الموقع (@/) — انكسر العزل");
    assert.ok(!/prisma|getSession|guard\(|jwtVerify/i.test(r), "الجسرُ يلمس القاعدةَ أو الجلسات — انكسر العزل");
    assert.ok(r.includes("globalThis"), "الجسرُ فقد ذاكرةَ العملية — أين تُخزَّن بياناتُ العرض؟");
    assert.ok(r.includes("s.requests.length > 50"), "سقفُ الطلبات (50) ضاع — طوفانٌ محتمل على مسارٍ عامّ");
    assert.ok(r.includes("rateLimited"), "حدُّ الإرسال ضاع — مسارٌ عامٌّ بلا كوابح");
    assert.ok(r.includes('startsWith("data:image/")'), "صورُ الإعلانات لم تعد مقيّدةً بـdata: — حقنُ روابطَ خارجيةٍ للمشتركين");
  });
});
