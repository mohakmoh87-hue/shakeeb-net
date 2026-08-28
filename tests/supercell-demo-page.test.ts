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
  test("المسارُ يقدّم ملفّاً ثابتاً بلا أيّ استيرادٍ من كود الموقع", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/supercell/route.ts"), "utf8");
    assert.ok(route.includes('path.join(process.cwd(), "public", "supercell.html")'),
      "المسارُ لم يعد يقرأ الملفَّ الثابت من public — وDockerfile ينسخها كاملةً لمخرجات standalone");
    // صفرُ تدخّل: لا Prisma ولا جلسات ولا src/lib ولا مكوّنات
    assert.ok(!/from "@\//.test(route), "المسارُ صار يستورد من كود الموقع (@/) — انكسر العزل");
    assert.ok(!/prisma|getSession|guard\(/.test(route), "المسارُ يلمس القاعدةَ أو الجلسات — انكسر العزل");
    assert.ok(route.includes("noindex"), "الصفحةُ بلا noindex — عرضٌ تسويقيٌّ لا يُفهرَس");
  });

  test("الملفُّ الثابتُ موجودٌ، وهميُّ البيانات، وبلا أيّ نداءِ شبكة", () => {
    const p = path.join(ROOT, "public/supercell.html");
    assert.ok(fs.existsSync(p), "public/supercell.html غيرُ موجود — المسارُ سيعيد 500");
    const html = fs.readFileSync(p, "utf8");
    assert.ok(html.startsWith("<!doctype html>"), "الملفُّ بلا هيكل مستند كامل");
    assert.ok(html.includes("بيانات وهمية"), "وسمُ «بيانات وهمية» ضاع — قد تُقرأ الصفحةُ حقيقيّةً");
    assert.ok(html.includes('name="robots" content="noindex'), "ميتا noindex ضاعت من الملفّ");
    // «صفر تدخل»: لا fetch ولا XMLHttpRequest ولا أيّ مسار /api — بياناتُها محقونةٌ فيها
    assert.ok(!/fetch\s*\(|XMLHttpRequest|\/api\//.test(html), "الصفحةُ صارت تنادي الشبكة — انكسر «صفر تدخل»");
  });

  test("حارسُ الدخول يستثني /supercell — تفتحها الشركةُ بلا حساب", () => {
    const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    assert.ok(/PUBLIC_PATHS = \[[^\]]*"\/supercell"/.test(proxy),
      "/supercell سقطت من المسارات العامّة — الزائرُ سيُحوَّل إلى /login");
  });
});
