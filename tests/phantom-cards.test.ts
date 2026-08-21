import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🔴 الكروتُ الوهميّةُ تُرجع كروتاً **مستخدمةً حقّاً** (بلاغُ محمد 2026-08-13) ═════
//
// «يرجع الكروت المستخدمة أيضاً في صفحة الكروت الوهمية، وعند تحديدها وضغط ربط فإنه يربط
//  الكارتات المستخدمة بمشتركيها ويحذفها من القائمة» — أي أنّها لم تكن وهميّةً قطّ.
// تكرّر لأكثرِ من وكيلٍ وحتى شكيب.
//
// 🎯 وقياسُ الإنتاج أعطى بصمةً قاطعة (١٠٦ تشغيلاً لجرد الكروت):
//   • ١١ من ١١ تشغيلاً وسم كروتاً وهميّةً ⇒ فيه **«سليم ٠»** — ولا كارتٌ واحدٌ مُثبَت.
//   • و٥٥ تشغيلاً سليماً أثبت كروتاً ولم يسم شيئاً. **والفصلُ تامّ.**
//   • أكبرها: المواصلات ٨٦٧ كارتاً في تشغيلٍ واحد، ثمّ ٢٦٦ · والقائمُ ظلماً ٥٣٦ كارتاً.
//
// 🔑 والدرسُ المُجرَّد: **الغيابُ لا يُثبت العدمَ إلّا إن أثبت الحضورُ نفسَه في المصدر
//   نفسِه.** فحين لا يُثبَت شيءٌ إطلاقاً، الخبرُ عن **مصدرِ الأدلّة** لا عن الكروت.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SRC = () => read("src/lib/subscriptionSync.ts");

/** إعادةُ تمثيلِ قاعدةِ الحكم كما هي في الشيفرة — تُقرأ منها لا تُنسَخ يدويّاً،
 *  فلو غُيِّر الشرطُ في المصدر ولم يعد يُطابق، سقط الاختبارُ بدل أن يُطمئن كذباً. */
function ruleFromSource(): { minSample: number; expr: string } {
  const src = SRC();
  const m = /const PHANTOM_MIN_VERIFIED_SAMPLE = (\d+);/.exec(src);
  assert.ok(m, "ثابتُ أدنى العيّنة غائبٌ من المصدر");
  const e = /const evidenceBroken = ([^;]+);/.exec(src);
  assert.ok(e, "شرطُ «الأدلّةُ معطوبة» غائبٌ من المصدر");
  return { minSample: Number(m![1]), expr: e![1] };
}

describe("الكروتُ الوهميّة: لا حكمَ بغيابِ دليلٍ لم يثبت أنّه يحضر", () => {
  test("الحكمُ يُؤجَّل بعد الحلقة — لا يُكتَب وسمٌ داخلها", () => {
    const src = SRC();
    const audit = src.slice(src.indexOf("export async function runFullCardAudit"));
    const loop = audit.slice(audit.indexOf("for (const c of cards)"), audit.indexOf("const evidenceBroken"));
    // 🔑 لو بقي الوسمُ داخل الحلقة لَما أمكن الحكمُ على صلاحيّة الأدلّة إلّا بعد فوات
    //   الأوان — فالكروتُ تُوسَم قبل أن يُعرَف أنّ المصدرَ معطوب.
    assert.equal(/SYNC_PHANTOM_VERIFIED/.test(loop), false, "الوسمُ ما زال يُكتب داخل الحلقة");
    assert.match(loop, /candidates\.push\(/, "المرشَّحون لا يُجمَعون للحكم المؤجَّل");
  });

  test("🎯 لا يُوسَم كارتٌ إلّا بعد فشلِ البحثِ الموجَّه بسيريالِه", () => {
    // شرحُ محمد حسم السبب: **كلُّ تفعيلٍ بكارت**، لكنّه يقع بثلاث طرق — المشتركُ يُفعّل
    // لنفسه من تطبيق سوبر سيل (فيظهر باسم موقعه `FDT13-MU` لا باسم المكتب) · أو يُفعّل
    // المكتبُ له · أو تفعيلُ ديلر (٩٠ يوماً). فقائمةُ تفعيلات حسابِ المكتب **لا تحمل كلَّ
    // ما استُخدم من كروته** — وهي سياسةُ سوبر سيل لا عطبٌ يُصلَح.
    // 🔑 والدواءُ كان في البرنامج سلفاً: `sasSearchActivation` تبحث بالسيريال فتجد التفعيل
    //   مهما كان تاريخُه ومَن أجراه — وهي سرُّ نجاح زرّ «ربط» الذي كان محمد يُصلح به ما
    //   وسمناه ظلماً. والمرحلةُ الأولى تستعملها؛ والجردُ الشاملُ كان يحكم بالقائمة وحدَها.
    const src = SRC();
    const audit = src.slice(src.indexOf("export async function runFullCardAudit"));
    const gate = audit.slice(0, audit.indexOf("const evidenceBroken"));
    assert.match(gate, /sasFindSerial\(s\.base, s\.token/, "الجردُ لا يتحقّق بسيريال الكارت من نافذة التفعيلات");
    // والبحثُ يجري في **كلّ لوحات المكتب** — كارتٌ فُعِّل على الثانية لا يوجد في الأولى
    assert.match(gate, /for \(const s of sessions\)/, "البحثُ لا يمرّ على لوحات المكتب كلِّها");
    // وما وُجد يُحسَب مُثبَتاً — فلا يبقى مشتبَهاً به، **ويُخلَّد إثباتُه** فلا يُفحَص ثانيةً
    assert.match(gate, /if \(foundReal\[i\]\) \{\s*\n\s*res\.verifiedReal\+\+/, "ما وجده البحثُ لا يُحسَب حقيقيّاً");
    assert.match(gate, /storeProven\(/, "الإثباتُ لا يُخلَّد — فتُعاد نفسُ البحوث كلَّ جرد");
    // ═════ قاعدةُ محمد 2026-08-14 (حادثةُ وسمِ ١٣٦ ظلماً): سقفٌ يمنع حلقةً ضخمة، والفائضُ
    //   فوقه **لا يُبرَّأ ولا يُدان** — يُحتسب خطأً ويُستكمل في الجرد القادم. الاختبارُ السابق
    //   كان يحرس عكسَها («يبقى مشتبهاً» فيُوسَم بلا فحص) وهو عينُ ما وسم ١٣٦ كارتاً سليماً.
    assert.match(gate, /MAX_VERIFY/, "لا سقفَ لعدد عمليّات البحث");
    assert.match(gate, /const stillSuspect: typeof candidates = \[\]/, "الفائضُ فوق السقف ما زال يدخل المشتبَهين فيُوسَم بلا فحص");
    assert.match(gate, /res\.errors \+= overflow\.length/, "الفائضُ لا يُعلَن خطأً ظاهراً");
    // 🔑 والمُثبَتُ سابقاً يُستثنى قبل أيّ حكمٍ — «مستخدَمٌ ثبت لا يُعاد ولا يُوسَم أبداً»
    assert.match(gate, /provenReal\.has\(serial\)/, "لا استثناءَ للمُثبَت سابقاً — تُعاد البحوثُ ويُحتمل وسمُ مُثبَت");
    // ويُخبَر المدير بعدد ما أنقذه البحث — وإلّا بدا الجردُ كأنّه لم يجد شيئاً
    assert.match(gate, /وُجد بالبحث بالسيريال/, "لا إبلاغَ بعدد ما أنقذه البحثُ الموجَّه");
  });

  test("قاعدةُ الحكم: صفرُ مُثبَتٍ مع عيّنةٍ كافية ⇒ لا يُوسَم شيء", () => {
    const { minSample, expr } = ruleFromSource();
    assert.match(expr, /res\.verifiedReal === 0/, "الشرطُ لا يفحص «ولا كارتٌ مُثبَت»");
    assert.match(expr, /res\.checkedUsed >= PHANTOM_MIN_VERIFIED_SAMPLE/, "الشرطُ بلا حدٍّ أدنى للعيّنة");
    assert.ok(minSample >= 2 && minSample <= 10, `حدُّ العيّنة غيرُ معقول: ${minSample}`);

    // ومحاكاةُ القاعدة على **أرقام الإنتاج الحقيقيّة** (من audit_logs):
    const broken = (verifiedReal: number, checkedUsed: number) => verifiedReal === 0 && checkedUsed >= minSample;
    // ١١ تشغيلاً وسم ظلماً — كلُّها يجب أن تُمنَع (وواحدٌ بعيّنةٍ ١ يبقى مسموحاً: لا دليلَ فيه)
    const badRuns = [
      { office: "المواصلات", used: 266, real: 0 }, { office: "المواصلات", used: 867, real: 0 },
      { office: "المواصلات", used: 23, real: 0 }, { office: "المواصلات", used: 8, real: 0 },
      { office: "صفاء", used: 15, real: 0 }, { office: "صفاء", used: 36, real: 0 },
      { office: "صميم", used: 3, real: 0 }, { office: "صميم", used: 12, real: 0 },
    ];
    for (const r of badRuns) {
      assert.equal(broken(r.real, r.used), true, `${r.office}: تشغيلٌ عاطبٌ (مستخدم ${r.used} · سليم ٠) ما زال يوسم`);
    }
    // ٥٥ تشغيلاً سليماً — لا يجوز تعطيلُ أيٍّ منها
    const goodRuns = [
      { office: "الشدن", used: 223, real: 223 }, { office: "الشدن", used: 165, real: 165 },
      { office: "الرسالة", used: 154, real: 154 }, { office: "الشدن", used: 208, real: 208 },
    ];
    for (const r of goodRuns) {
      assert.equal(broken(r.real, r.used), false, `${r.office}: تشغيلٌ سليمٌ عُطِّل ظلماً`);
    }
    // ومزيجٌ حقيقيٌّ (٥ تشغيلاتٍ أثبتت ووسمت معاً) يبقى عاملاً — فالاكتشافُ الصحيحُ لا يُخنَق
    assert.equal(broken(40, 50), false, "تشغيلٌ أثبت ٤٠ ووسم بعضَها — عُطِّل ظلماً");
    // وعيّنةٌ أصغرُ من الحدّ تبقى مسموحةً (لا دليلَ في الاتجاهَين)
    assert.equal(broken(0, 1), false, "كارتٌ واحدٌ بلا إثباتٍ عُطِّل — الحدُّ الأدنى معطوب");
  });

  test("المنعُ يُبلَّغ للمدير — لا يُسكَت عنه", () => {
    const src = SRC();
    // 🔑 صمتٌ هنا أخطرُ من الوسم الكاذب: يظنّ محمدُ أنّ الجردَ مرّ سليماً بلا وهميّات،
    //   بينما الحقيقةُ أنّ قائمةَ التفعيلات لم تصل — فلا يُدقَّق سببُ العطب أبداً.
    assert.match(src, /res\.error = `تعذّر التحقّق من الكروت/, "المنعُ بلا رسالةٍ ظاهرةٍ للمدير");
    assert.match(src, /res\.events\.push\(\{[\s\S]{0,200}كانت ستُدرَج ظلماً/, "لا يُسجَّل عددُ ما كان سيُدرَج ظلماً");
  });

  test("الجردُ يجمع أدلّةَ **كلّ** لوحات المكتب لا الأولى وحدَها", () => {
    const src = SRC();
    const audit = src.slice(src.indexOf("export async function runFullCardAudit"));
    const head = audit.slice(0, audit.indexOf("const actByPin"));
    // كارتٌ فُعِّل على اللوحة الثانية لا تفعيلَ له في قائمة الأولى ⇒ وهميٌّ ظلماً.
    // وقِيس: جردُ صميم يجلب ٢٤٩ تفعيلاً من «صميم١» و«صميم٢» وحدَها فيها ~١٠٠١.
    assert.match(head, /panelsOfTower\(officeId\)/, "الجردُ ما زال على لوحةٍ واحدة");
    assert.match(head, /for \(const sc of scopes\)/, "لا يُمرَّر على اللوحات");
    assert.match(head, /acts\.push\(\.\.\.r\.rows\)/, "أدلّةُ اللوحات لا تُدمَج");
    // وبلا لوحاتٍ يبقى السلوكُ القديم حرفيّاً (أعمدةُ المكتب)
    assert.match(head, /credsOfTower\(officeId\)/, "سقط مسارُ «مكتبٌ بلا لوحات»");
  });

  test("لوحةٌ تعذّر جلبُها ⇒ لا حكمَ إطلاقاً (الغيابُ لا يُثبت شيئاً)", () => {
    const src = SRC();
    const audit = src.slice(src.indexOf("export async function runFullCardAudit"));
    const head = audit.slice(0, audit.indexOf("const actByPin"));
    // لو مضى الجردُ بأدلّةِ لوحةٍ واحدةٍ بعد فشل الأخرى، صار كلُّ كارتِ اللوحة الفاشلة وهميّاً
    assert.match(head, /return \{ \.\.\.empty, error: `فشل الاتصال بـ SAS/, "فشلُ لوحةٍ لا يُوقف الحكم");
    assert.match(head, /if \(!r\.complete\) complete = false/, "نقصُ صفحاتِ لوحةٍ لا يُسقط الثقة");
  });
});
