import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🔴 لوحتان مفتوحتان معاً ⇒ «Access Denied» (بلاغُ صميم 2026-08-13) ═════
//
// هذه العلّةُ **ارتدّت ثلاث مرّات**، وكلُّ إصلاحٍ كان يعالج طريقاً ويترك الأصلَ قائماً:
//   ١. الوسيطُ يتجاهل اللوحةَ ⇒ أُصلح بحقنِ رمزها عند التحميل … فارتدّ بعد أوّل تنقُّل.
//   ٢. الطلباتُ الداخليّةُ بلا معامل ⇒ أُصلح بكعكةٍ … والكعكةُ لكلّ **المتصفّح** فارتدّ.
//   ٣. والرمزُ في `localStorage` — وهو لكلّ المتصفّح أيضاً.
//
// والأصلُ واحدٌ في الثلاث: **خزائنُ ذاتُ خانةٍ واحدةٍ مشتركةٍ بين التبويبات**، وكلُّها
// «آخرُ مَن فُتح يفوز». فتبويبان مفتوحان يتقاتلان، ويظهر الخطأُ في تبويبٍ **لم يُلمَس**.
//
// ⇒ فالحرسُ هنا على **الأصل** لا على أعراضه: اللوحةُ تسافر في المسار (ملكُ التبويب)،
//   والرمزُ يُفرَض من الخادم. وأيُّ عودةٍ إلى خانةٍ مشتركةٍ يُسقطها هذا الملفّ.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("لوحتا ساسٍ في مكتبٍ واحد", () => {
  test("مقطعُ المسار يحمل اللوحةَ ويُقرأ منها — ذهاباً وعودة", async () => {
    const { sasScopeSegment, parseSasScope, sasScopedPath } = await import("../src/lib/sasScope");
    assert.equal(sasScopeSegment(43, 11), "43~p11");
    assert.equal(sasScopeSegment(43, null), "43", "بلا لوحةٍ يجب أن يبقى المقطعُ كما كان — لا تغييرَ سلوك");
    assert.deepEqual(parseSasScope("43~p11"), { towerId: 43, panelId: 11 });
    assert.deepEqual(parseSasScope("43"), { towerId: 43, panelId: null });
    // ولا يُخمَّن رقمٌ من نصٍّ فاسد (وإلّا فُتحت لوحةٌ لم تُطلَب)
    for (const bad of ["", "abc", "43~p", "43~px", "0", "43~p0", "-1", "43~p11~p12", " 43 ~p11"]) {
      assert.equal(parseSasScope(bad), null, `قُبِل مقطعٌ فاسد: «${bad}»`);
    }
    assert.equal(sasScopedPath(43, 11, "user/activate/900"), "/sas/43~p11/#/user/activate/900");
    assert.equal(sasScopedPath(43, null, "users/index"), "/sas/43/#/users/index");
  });

  test("لا موضعَ يبني رابطَ لوحةٍ بالمعامل `?panel=` — المسارُ وحدَه", () => {
    const files = [
      "src/components/ActivationModal.tsx",
      "src/lib/sasEmbed.ts",
      "src/app/(app)/subscribers/sas4/page.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      // 🔑 المعاملُ يسقط بعد أوّل تحميل (التطبيقُ أحاديُّ الصفحة)، فتعود اللوحةُ للخانة
      //   المشتركة — وهو الارتدادُ الأوّل بعينه.
      assert.equal(/\?panel=\$\{/.test(src), false, `${f}: ما زال يبني الرابطَ بـ?panel=`);
      assert.match(src, /sasScopedPath\(/, `${f}: لا يستعمل مقطعَ المسار الحاملَ للّوحة`);
    }
  });

  test("مسارُ الـAPI موسومٌ باللوحة في المسارَين (السحابيّ والعامل)", () => {
    // كان `/admin/...` جذراً فيُوجَّه بمتغيّرٍ عامٍّ واحد ⇒ آخرُ لوحةٍ فُتحت تفوز
    const worker = read("src/lib/localSasServer.ts");
    assert.equal(/const apiUrl = `\/admin\//.test(worker), false, "العاملُ ما زال ينادي /admin/ جذراً");
    assert.match(worker, /const apiUrl = `\/sas\/\$\{scoped\}\/admin\//, "مسارُ API العامل غيرُ موسومٍ باللوحة");
    const token = read("src/app/api/sas4/token/route.ts");
    assert.match(token, /sasScopeSegment\(towerId, panelId\)/, "مسارُ API السحابة غيرُ موسومٍ باللوحة");
  });

  test("رمزُ اللوحة يُفرَض من الخادم — فلا يضرّه `localStorage` المشترك", () => {
    const proxy = read("src/lib/sasProxy.ts");
    assert.match(proxy, /authOverride\?:\s*\(\)\s*=>\s*Promise<string>/, "لا سبيلَ لفرضِ الرمز في الوسيط");
    // ⚠️ ولا يُفرَض إلّا حيث كان رمزٌ أصلاً: وإلّا سجّلنا دخولاً للساس مع كلّ أصلٍ ثابت
    assert.match(proxy, /if \(auth\) \{[\s\S]{0,400}authOverride/, "الفرضُ خارجَ شرطِ وجود ترويسة الرمز");
    // وكلا المُوسِّطَين يُمرّره
    assert.match(read("src/lib/localSasServer.ts"), /scopeToken\(creds\)\)/, "العاملُ لا يفرض رمزَ اللوحة");
    assert.match(read("src/app/sas/[towerId]/[[...path]]/route.ts"), /scopedSasToken\(Number\(towerId\), panelId\)/,
      "الوسيطُ السحابيُّ لا يفرض رمزَ اللوحة");
  });

  test("الأولويّةُ للمسار على الكعكة والمعامل — وإلّا عاد التقاتلُ من بابها", () => {
    const cloud = read("src/app/sas/[towerId]/[[...path]]/route.ts");
    // `scope.panelId ?? (المعامل/الكعكة)` — المسارُ أوّلاً حرفيّاً
    assert.match(cloud, /scope\.panelId\s*\r?\n?\s*\?\?/, "المسارُ ليس مُقدَّماً على الكعكة");
    const worker = read("src/lib/localSasServer.ts");
    assert.match(worker, /seg\.panelId \?\? \(Number\(url\.searchParams\.get\("panel"\)\)/, "العاملُ لا يُقدّم المسار");
  });

  test("العزلُ باقٍ: اللوحةُ لا تُقبَل إلّا إن كانت لهذا المكتب", () => {
    // 🔒 مُعرِّفُ اللوحةِ يأتي من الرابط (يملكه المستخدم) — فلا يُقبَل بلا إثباتِ تبعيّته
    const worker = read("src/lib/localSasServer.ts");
    assert.match(worker, /async function panelOfTower\(towerId: number, panelId: number\)/, "غابت بوّابةُ تبعيّة اللوحة");
    const cloud = read("src/app/sas/[towerId]/[[...path]]/route.ts");
    // كلُّ قراءةٍ للوحةٍ في الوسيط السحابيّ مُقيَّدةٌ بـ`towerId` و`isDeleted`
    const reads = [...cloud.matchAll(/sasPanel\.findFirst\(\{\s*\r?\n?\s*where:\s*\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(reads.length >= 2, `قراءاتُ اللوحة أقلُّ من المتوقَّع: ${reads.length}`);
    for (const w of reads) {
      assert.match(w, /towerId/, "قراءةُ لوحةٍ بلا تقييدٍ بالمكتب — تسريبٌ بين المكاتب");
      assert.match(w, /isDeleted:\s*false/, "قراءةُ لوحةٍ محذوفة");
    }
  });
});
