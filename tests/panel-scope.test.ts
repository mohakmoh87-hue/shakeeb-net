import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ أ-٢٣ · نطاقُ لوحة الساس لا يُرَشُّ على جدولٍ لا يملكه ═════
// بلاغُ صميم 2026-08-13: المزامنةُ تسقط بـ
//   «Invalid `prisma.loanDebt.findMany()` … Unknown argument `sasPanelId`»
// على مكتبٍ بلوحتَين — فتضيع **المرحلةُ الثانيةُ كلُّها** (تصحيحُ التواريخ والاستيراد).
//
// والسببُ نمطيٌّ لا عارض: عند بناء «مكتبٌ بلوحتَي ساس» أُنشئ نطاقٌ عامٌّ
// (`panelWhere = { sasPanelId }`) ونُشر على استعلاماتِ المزامنة — وثلاثةٌ منها على
// `Subscriber` (وهو **الجدولُ الوحيد** الذي يحمل العمود) والرابعُ على `LoanDebt`.
// و**بريزما لا تكتشفه إلّا وقتَ التشغيل**، فمرّ من `tsc` ومن كلّ اختبار.
//
// ⇒ فهذا الاختبارُ يُغني عن الذاكرة: يقرأ السكيمةَ فيعرف مَن يملك العمودَ فعلاً، ثمّ
//   يمسح المستودعَ فيُسقط أيَّ استعلامٍ يذكره على غيره. ويكتشف الصنفَ كلَّه لا الحالةَ.

const ROOT = process.cwd();
/** قراءةُ ملفٍّ بمسارٍ نسبيٍّ من جذر المستودع. */
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SCHEMA = path.join(ROOT, "prisma", "schema.prisma");
/** العمودُ محلُّ الحادثة — ويُزاد على القائمة كلُّ عمودٍ «نطاقيٍّ» يُرَشُّ على استعلامات. */
const SCOPED_FIELDS = ["sasPanelId", "odooPanelId"];

/** أسماءُ النماذج التي تُعلن عموداً بعينه في `schema.prisma`. */
function modelsDeclaring(field: string): Set<string> {
  const src = fs.readFileSync(SCHEMA, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    // إعلانُ عمودٍ يبدأ السطرَ باسمه — لا ذِكرُه في `@@index` أو في تعليق
    if (new RegExp(`^\\s{2}${field}\\s`, "m").test(m[2])) out.add(m[1]);
  }
  return out;
}

/** اسمُ النموذج كما تكتبه بريزما في الكود (`prisma.loanDebt` ⇒ `LoanDebt`). */
const toModel = (call: string): string => call.charAt(0).toUpperCase() + call.slice(1);

/** يُفرِغ التعليقاتَ من النصّ مع **حفظِ أطوالِه** (فتبقى أرقامُ السطور صحيحة).
 *  ولا بدّ منه: أخصبُ مصادرِ الإنذار الكاذب تعليقٌ يشرح **لماذا** لا يُستعمل العمود. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i); i = stop;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " "); i = stop;
    } else {
      out += src[i]; i++;
    }
  }
  return out;
}

/** جسمُ وسيطِ النداء بمطابقةِ الأقواس — لا نافذةٌ بعددِ حروفٍ مُخمَّن.
 *  فالنافذةُ الثابتةُ تتعدّى إلى النداء التالي وإلى ما بعده فتُنذر كذباً. */
function argBody(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen, Math.min(src.length, openParen + 2000));
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") sourceFiles(p, acc); }
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe("نطاقُ لوحة الساس: لا عمودَ نطاقٍ على جدولٍ لا يُعلنه", () => {
  test("السكيمةُ تُعلن `sasPanelId` على `Subscriber` (وهو مرجعُ الاختبار)", () => {
    const owners = modelsDeclaring("sasPanelId");
    assert.ok(owners.has("Subscriber"), "غاب العمودُ عن Subscriber — تغيّرت السكيمةُ فأعِد النظر");
    assert.ok(!owners.has("LoanDebt"),
      "صار `LoanDebt` يُعلن `sasPanelId`: إن كان بقصدٍ فأزِل استثناءَه من هذا الاختبار");
  });

  for (const field of SCOPED_FIELDS) {
    test(`لا استعلامَ بريزما يذكر \`${field}\` على نموذجٍ لا يُعلنه`, () => {
      const owners = modelsDeclaring(field);
      // `src` وحدَه: الاختباراتُ تتحدّث **عن** الاستعلامات ولا تُنفّذها
      const files = sourceFiles(path.join(ROOT, "src"));
      const bad: string[] = [];

      for (const f of files) {
        const raw = fs.readFileSync(f, "utf8");
        const src = stripComments(raw); // بلا هذا يُنذر أيُّ تعليقٍ يشرح البندَ كذباً
        // كلُّ نداءٍ `prisma.<model>.<op>(` أو `tx.<model>.<op>(` أو `t.<model>.<op>(`
        for (const m of src.matchAll(/\b(?:prisma|tx|t)\.([a-z][A-Za-z0-9]*)\.(findMany|findFirst|findUnique|count|update|updateMany|create|createMany|upsert|delete|deleteMany|aggregate|groupBy)\s*\(/g)) {
          const model = toModel(m[1]);
          const body = argBody(src, m.index + m[0].length - 1); // جسمُ الوسيط بمطابقةِ الأقواس
          // ⚠️ **موضعُ المفتاح وحدَه** — لا كلُّ ذِكر. فـ`{ id: s.sasPanelId }` يقرأ لوحةَ
          //   المشترك **قيمةً** ويُرشّح بـ`id`: استعلامٌ صحيحٌ تماماً، وأوّلُ نسخةٍ من هذا
          //   الاختبار أنذرت عليه كذباً. والمفتاحُ يتبعه `:` ولا يسبقه `.` (فـ`x.sasPanelId`
          //   قراءةُ خاصّيّةٍ من كائنٍ آخر لا مفتاحٌ في وسيطِ بريزما).
          const asKey = new RegExp(`(?<![.\\w])${field}\\s*:`);
          const mentions = asKey.test(body)
            || (field === "sasPanelId" && /\.\.\.panelWhere\b/.test(body));
          if (!mentions) continue;
          if (owners.has(model)) continue;
          const line = src.slice(0, m.index).split("\n").length;
          bad.push(`${path.relative(ROOT, f)}:${line} — prisma.${m[1]}.${m[2]}() يذكر ${field} و${model} لا يُعلنه`);
        }
      }

      assert.deepEqual(bad, [],
        `استعلامٌ سيسقط وقتَ التشغيل بـ«Unknown argument \`${field}\`» (وهو ما أسقط مزامنةَ صميم):\n  ${bad.join("\n  ")}`);
    });
  }
});

// ═════ 🔴 بلاغُ صميم 2026-08-13: «Access Denied من الساس نفسِه» ═════
// يفتح تفعيلَ مشتركٍ، فتُفتَح لوحةُ الساس، فيضع الكارتَ ويضغط «تفعيل» فيرفض **الساسُ**.
// والسببُ أنّ رابطَ اللوحة كان بلا `?panel=` وأنّ الوسيطَ المحليَّ **يتجاهله أصلاً**،
// فيُحقَن رمزُ **أعمدةِ المكتب** (= اللوحة الأولى) بينما المشتركُ على اللوحة الثانية:
//   لوحة ٩ «صميم 1»  ⇒ الحساب `sameem.faaq@slm`
//   لوحة ١١ «صميم2» ⇒ الحساب `Dajlat.Alsalam1@slm`   (قِيسا على الإنتاج)
// فالحسابُ المُسجَّلُ لا يملك ذلك المستخدم ⇒ Access Denied.
//
// والاختبارُ يحرس **السلسلةَ كاملةً** نصّاً، لأنّ حلقةً واحدةً ناقصةً تُعيد العلّة:
// النوعُ يحمل اللوحة ← الرابطُ يحملها ← المُعينُ يُمرّرها ← والوسيطُ المحليُّ **يقرؤها**.
describe("سلسلةُ لوحةِ الساس عند التفعيل — حلقةٌ ناقصةٌ تُعيد «Access Denied»", () => {
  test("نافذةُ التفعيل: النوعُ يحمل `sasPanelId` والروابطُ الثلاثةُ تُمرّره", () => {
    const src = read("src/components/ActivationModal.tsx");
    assert.ok(/sasPanelId\?: number \| null;/.test(src), "نوعُ المشترك يجب أن يحمل لوحته");
    // الرابطُ عبر وسيط الموقع
    assert.ok(/\?panel=\$\{sub\.sasPanelId\}/.test(src), "رابطُ الوسيط السحابيّ بلا `?panel=`");
    // الرابطُ عبر العامل المحليّ (حاسبةُ المكتب — وهو ما يعمل عليه صميم)
    assert.ok(/\?panel=\$\{subscriber\.sasPanelId\}/.test(src), "رابطُ العامل المحليّ بلا `?panel=`");
    // تجهيزُ الرمز
    assert.ok(/prepareSasEmbed\(subscriber\.towerId, subscriber\.sasPanelId\)/.test(src),
      "`prepareSasEmbed` تُنادى بلا لوحةٍ ⇒ الكعكةُ تُضبَط على اللوحة الأولى");
  });

  test("`prepareSasEmbed` تُرسل اللوحةَ إلى مسار الرمز", () => {
    const src = read("src/lib/sasEmbed.ts");
    assert.ok(/panelId\?: number \| null/.test(src), "المُعينُ لا يقبل لوحةً");
    assert.ok(/panelId != null \? \{ panelId \} : \{\}/.test(src), "اللوحةُ لا تُرسَل في جسم الطلب");
  });

  test("الوسيطُ المحليُّ (العامل) يقرأ `?panel=` ويستعمل رمزَ اللوحة", () => {
    const src = read("src/lib/localSasServer.ts");
    assert.ok(/searchParams\.get\("panel"\)/.test(src),
      "العاملُ يتجاهل `?panel=` ⇒ يُسجّل بحساب اللوحة الأولى دائماً (عينُ بلاغ صميم)");
    assert.ok(/scopeToken\(creds\)/.test(src),
      "الرمزُ المحقونُ يجب أن يكون رمزَ **اللوحة** لا `towerToken` (أعمدةِ المكتب)");
    assert.ok(/panelOfTower\(towerId, wantPanel\)/.test(src),
      "🔒 اللوحةُ تُقبَل بعد إثباتِ أنّها لوحةُ هذا المكتب — المُعرِّفُ يأتي من الرابط");
    // ونداءاتُ اللوحة تحتاج معرفةَ لوحتها: لوحتان قد تكونان على المُخدِّم نفسِه
    assert.ok(/currentPanel: \{ towerId: number; host: string; panelId: number \| null \}/.test(src),
      "المضيفُ وحدَه لا يُميّز لوحتَين على مُخدِّمٍ واحد (صميم: كلتاهما 82.129.22.22)");
  });

  test("الوسيطُ السحابيُّ كان سليماً — فلا يُنقَض بالإصلاح", () => {
    const src = read("src/app/sas/[towerId]/[[...path]]/route.ts");
    assert.ok(/sp\.get\("panel"\)/.test(src), "يقرأ المعامل");
    assert.ok(/sas_panel/.test(src),
      "ويرتدّ إلى الكعكة — فصفحةُ الساس تطبيقٌ أحاديُّ الصفحة وطلباتُها الداخليّةُ بلا معامل");
  });
});

// ═════ الديلر/القروض يتبع اللوحةَ — بنفسِ دروسِ علّة الساس ═════
// طلبُ محمد: «بالانتفاعِ من المشاكل التي حدثت مع الساس وأصلحتَها أريد الديلرَ بلا مشاكل».
// والدروسُ الأربعةُ التي دفعنا ثمنَها اليومَ، مُطبَّقةً هنا كشروطٍ محروسة:
//  ١) كلُّ موضعٍ **يُصادِق** يجب أن يحسم اللوحةَ لا المكتب (وإلّا: Access Denied).
//  ٢) حلقةٌ واحدةٌ ناقصةٌ في السلسلة تُرجع إلى اللوحة الأولى **صامتاً** ⇒ تُحرَس السلسلةُ كلُّها.
//  ٣) الارتدادُ إلى المكتب **مقصودٌ** لا نسيان — فالمكاتبُ ذاتُ اللوحة الواحدة لا تتأثّر.
//  ٤) **الاختبارُ يجب أن يُشبه العمليّةَ الحقيقيّة**: اختبارُ اتصالٍ يقرأ حساباً غيرَ الذي
//     يُستعمَل في المنح، أو يُجرّبه على مشتركِ لوحةٍ أخرى — يُطمئن كذباً. وهذا ما اصطدناه.
describe("الديلر/القروض يتبع اللوحةَ — دروسُ علّة الساس مُطبَّقة", () => {
  test("السكيمةُ: `SasPanel` يحمل حسابَ الديلر، و`loanEnabled/loanMode` يبقيان على المكتب", () => {
    const src = fs.readFileSync(SCHEMA, "utf8");
    const panel = /^model SasPanel \{([\s\S]*?)^\}/m.exec(src)?.[1] ?? "";
    const tower = /^model Tower \{([\s\S]*?)^\}/m.exec(src)?.[1] ?? "";
    assert.ok(/^\s{2}loanUser\s/m.test(panel), "اللوحةُ بلا `loanUser` ⇒ حسابُ ديلرٍ واحدٌ للمكتب");
    assert.ok(/^\s{2}loanPass\s/m.test(panel), "اللوحةُ بلا `loanPass`");
    // 🔑 والسياسةُ تبقى للمكتب: هو وحدةُ العمل، واللوحةُ نقطةُ بنيةٍ تحتيّة
    assert.ok(!/^\s{2}loanEnabled\s/m.test(panel),
      "`loanEnabled` على اللوحة: تلك سياسةٌ للمكتب لا بيانَ دخولٍ — إن كان بقصدٍ فحدِّث الاختبار");
    assert.ok(/^\s{2}loanEnabled\s/m.test(tower) && /^\s{2}loanMode\s/m.test(tower),
      "السياسةُ يجب أن تبقى على المكتب");
  });

  test("المُحلِّل: `loanCredsOfSubscriber` تقرأ لوحةَ المشترك وترتدّ إلى المكتب", () => {
    const src = read("src/lib/sasPanel.ts");
    assert.ok(/export async function loanCredsOfSubscriber/.test(src), "غاب المُحلِّل");
    assert.ok(/sasPanelId: true/.test(src), "لا يقرأ لوحةَ المشترك");
    assert.ok(/id: s\.sasPanelId, towerId: s\.towerId/.test(src),
      "🔒 اللوحةُ يجب أن تُقيَّد بمكتب المشترك — وإلّا قُبلت لوحةُ مكتبٍ آخر");
    assert.ok(/prisma\.tower\.findUnique/.test(src),
      "الارتدادُ إلى أعمدة المكتب مقصود — بلاه تتوقّف المكاتبُ الستّةُ المفعَّلة");
  });

  test("المنحُ يستعمل المُحلِّلَ لا أعمدةَ المكتب", () => {
    const src = read("src/app/api/subscribers/[id]/loan/route.ts");
    assert.ok(/loanCredsOfSubscriber\(subscriber\.id\)/.test(src), "المنحُ لا يحسم اللوحة");
    assert.ok(!/decryptSecret\(office\.loanPass\)/.test(src),
      "المنحُ ما زال يقرأ كلمةَ مرور **المكتب** مباشرةً ⇒ حسابُ اللوحة الأولى دائماً");
  });

  test("🔑 اختبارُ الاتصال يختبر **حسابَ اللوحة** على **مشتركٍ منها**", () => {
    const src = read("src/app/api/towers/[id]/loan-test/route.ts");
    assert.ok(/panelId: z\.coerce\.number\(\)/.test(src), "الاختبارُ لا يقبل لوحةً ⇒ يختبر المكتبَ دائماً");
    assert.ok(/prisma\.sasPanel\.findFirst/.test(src), "لا يقرأ حسابَ اللوحة المخزَّن");
    assert.ok(/panelId != null \? \{ sasPanelId: panelId \} : \{\}/.test(src),
      "العيّنةُ من أيّ لوحةٍ ⇒ حسابُ لوحةٍ يُختبَر على مشتركِ أخرى فيُقال «الحسابُ خطأ» وهو صحيح");
    assert.ok(/testedUser/.test(src) && /scope/.test(src),
      "النتيجةُ يجب أن تُسمّي ما اختُبر — الاختبارُ الصامتُ هو ما أخفى علّةَ الساس");
  });

  test("الواجهة: حقلا الحساب موجودان وزرُّ اختبارٍ **لكلّ لوحة**", () => {
    const src = read("src/components/SasPanelsButton.tsx");
    assert.ok(/loanUser: string \| null; hasLoanPass: boolean/.test(src), "النوعُ بلا حسابِ قرض");
    assert.ok(/hasLoanPass/.test(src), "كلمةُ المرور لا تُعاد — تُعرَض علامةُ وجودٍ فقط");
    assert.ok(/testLoan\(p\.id\)/.test(src),
      "بلا زرِّ اختبارٍ لكلّ لوحةٍ يضبط المديرُ حساباً ولا يعرف أصحيحٌ هو حتى يفشل المنح");
  });

  test("المسارُ لا يُعيد كلمةَ مرور القرض أبداً", () => {
    const src = read("src/app/api/towers/[id]/panels/route.ts");
    assert.ok(/hasLoanPass: !!p\.loanPass/.test(src), "علامةُ الوجود غائبة");
    assert.ok(!/loanPass: p\.loanPass/.test(src), "⛔ كلمةُ مرور الديلر تُعاد إلى الواجهة!");
    assert.ok(/encryptSecret\(d\.loanPass\)/.test(src),
      "كلمةُ مرور الديلر تُخزَّن صريحةً — وهي بيانُ دخولٍ لنظامٍ ماليٍّ خارجيّ");
  });
});

// ═════ أودو على لوحتَين: مفتاحٌ حقيقيٌّ لا عرضٌ فقط ═════
// سؤالُ محمد: «هل إذا فعّل واحداً من الأودو وترك الآخرَ غيرَ متّصلٍ سيعمل طبيعيّاً؟»
// والجوابُ نعم — لكنّ التدقيقَ كشف أنّ **إشعالَه للّوحة الثانية كان مستحيلاً**: المسارُ
// يقبل `odooEnabled` والواجهةُ **تعرضه ولا تُغيّره** ⇒ يُضبط حسابُها فتبقى «خامدة»
// و`isActive` تردّ false فلا تُزامَن أبداً، **بلا أيّة رسالة**.
describe("أودو على لوحتَين — الإشعالُ والإطفاءُ لكلّ لوحةٍ على حدة", () => {
  test("الواجهةُ تملك مفتاحاً يُغيّر `odooEnabled` لا عرضاً فقط", () => {
    const src = read("src/components/SasPanelsButton.tsx");
    assert.ok(/async function toggleOdoo/.test(src), "لا مفتاحَ إشعالٍ للّوحة ⇒ الثانيةُ لا تُزامَن أبداً");
    assert.ok(/odooEnabled: next/.test(src), "المفتاحُ لا يُرسل القيمةَ الجديدة");
    assert.ok(/disabled=\{busy \|\| !\(p\.odooUser && p\.hasOdooPass\)\}/.test(src),
      "يجب تعطيلُ المفتاح بلا حسابِ أودو: لوحةٌ بلا حسابٍ تسقط من المُرشِّح فالمفتاحُ يكذب");
  });

  test("المزامنةُ تُعزل الأخطاءَ بين اللوحات ولا تُسقط إحداهما الأخرى", () => {
    const src = read("src/lib/odooSync.ts");
    // كلُّ لوحةٍ في `try` خاصٍّ وخطؤها يُكتَب في صفّها هي
    assert.ok(/saveOdooState\(o, \{ odooLastOk: null, odooLastError:/.test(src),
      "خطأُ اللوحة يجب أن يُكتَب في صفّها — وإلّا دهس خطأُ الثانية شارةَ الأولى الخضراء");
    assert.ok(/if \(o\.panelId != null\) await prisma\.sasPanel\.update/.test(src),
      "كتابةُ الحالة يجب أن تُوجَّه لصفّ اللوحة لا المكتب");
    // لوحةٌ بلا حسابٍ لا تدخل القائمةَ أصلاً — ومصيدةُ النصّ الفارغ محروسة
    assert.ok(/notIn: \[""\]/.test(src),
      "⚠️ `not: null` وحدَه لا يكفي: لوحاتُ صميم فيها `odooUser = \"\"` فتفشل كلَّ دورة");
    // ومخزنُ الجلسة بمفتاح اللوحة لا المكتب — وإلّا تشاركت اللوحتان توكناً واحداً
    assert.ok(/o\.panelId \?\? o\.id/.test(src), "مخزنُ الجلسة بمفتاح المكتب ⇒ توكنٌ واحدٌ للوحتَين");
  });
});
