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

describe("🏢 بوّابة /supercell الحقيقيّة معزولةٌ بجلسة الشركة (لا المستخدم)", () => {
  // القطعة ٥ (2026-08-29): حلّت بوّابةٌ حقيقيّةٌ (page.tsx) محلَّ عرض الـ120 وكيلاً الوهميّ (route.ts محذوف).
  test("/supercell صفحةٌ محروسةٌ بجلسة الشركة، محجوبةٌ 404 عند الإطفاء، لا تلمس جلسةَ المستخدم", () => {
    const pagePath = path.join(ROOT, "src/app/supercell/page.tsx");
    assert.ok(fs.existsSync(pagePath), "صفحةُ /supercell الحقيقيّة غيرُ موجودة");
    const page = fs.readFileSync(pagePath, "utf8");
    // 404 عند إطفاء البوّابة (طلب محمد)
    assert.ok(page.includes("getPortalEnabled") && page.includes("notFound"), "بوّابةُ /supercell لا تُحجب بـ404 عند إطفاء المالك");
    // تُحرَس بجلسة الشركة المنفصلة (kabina_company)، لا بجلسة المستخدم الداخليّة
    assert.ok(page.includes("getCompanySession"), "/supercell لا تُحرَس بجلسة الشركة");
    assert.ok(!/getSession\b|guard\(/.test(page), "/supercell تلمس جلسةَ المستخدم الداخليّة — يجب جلسةَ الشركة حصراً");
    assert.ok(/robots:\s*\{\s*index:\s*false/.test(page), "noindex ضاع من البوّابة");
    // لا route.ts ثابتٌ متبقٍّ (يتعارض مع page.tsx)
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/supercell/route.ts")), "route.ts الساكن ما زال موجوداً مع page.tsx — تعارض");
  });

  test("تحريرُ الشركة للإعلانات محروسٌ بجلسة الشركة ويكتب المحتوى فقط (لا أعلامَ المالك)", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "src/app/api/company/config/route.ts"), "utf8");
    assert.ok(cfg.includes("getCompanySession"), "مسارُ تحرير الشركة لا يُحرَس بجلسة الشركة");
    assert.ok(!/getSession\b|guard\(/.test(cfg), "مسارُ تحرير الشركة يلمس جلسةَ المستخدم — يجب جلسةَ الشركة حصراً");
    // الشركةُ تكتب المحتوى فقط؛ الأعلام (companyMode/portalEnabled) للمالك حصراً
    assert.ok(cfg.includes("setAppContent") && !/setCompanyMode|setPortalEnabled/.test(cfg), "الشركةُ تكتب أعلامَ المالك — تجاوزُ صلاحيّة");
  });

  test("حارسُ الدخول يستثني /supercell — تفتحها الشركةُ بلا جلسة مستخدم", () => {
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
