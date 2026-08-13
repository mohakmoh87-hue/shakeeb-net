import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ أ-١ · شاشةُ «بصمات الحضور» (طلبُ محمد) ═════
//
// بنصّ الطلب: «شاشةٌ تُظهر كلّ فنيّي كلّ المكاتب الذين بصموا اليوم **حصراً**» + «زرّ
// «سجل» يُظهر كلّ الفنيّين، وبالضغط على فنيٍّ تظهر كلّ بصماته».
//
// والخلفيّةُ كانت جاهزةً سلفاً؛ فالحرسُ هنا على ثلاثة أمور تُفسد الشاشةَ بصمت:
//   ١. «حصراً» — لو عُرض غيرُ مَن بصم لَغرِق الجوابُ عن سؤال «مَن عندي اليوم؟».
//   ٢. التوقيت — القيَمُ تأتي UTC؛ وعرضُها بلا منطقةٍ يُظهر بصمةَ ٨ صباحاً كأنّها ٥.
//   ٣. العزل — يجب أن يبقى على الخادم، ولا تُرشِّح الواجهةُ أمناً.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PAGE = "src/app/(app)/attendance/page.tsx";

describe("أ-١ · شاشةُ بصمات الحضور", () => {
  test("الافتراضُ: مَن بصم اليوم حصراً — و«سجل» يُظهر الكلّ", () => {
    const src = read(PAGE);
    assert.match(src, /const stamped = techs\.filter\(\(t\) => t\.state !== "none"\)/, "لا ترشيحَ لمن بصم اليوم");
    assert.match(src, /const shown = showAll \? techs : stamped/, "المعروضُ ليس المُرشَّحَ افتراضاً");
    assert.match(src, /useState\(false\)/, "«سجل» مفتوحٌ افتراضاً ⇒ يُخالف «حصراً»");
    assert.match(src, /سجل/, "لا زرَّ «سجل»");
  });

  test("بصماتُ فنيٍّ واحدٍ تُجلَب بمُعرّفه من المسار الجاهز", () => {
    const src = read(PAGE);
    assert.match(src, /attendance\?technicianId=\$\{t\.id\}/, "لا جلبَ لسجلّ الفنيّ");
    assert.match(src, /كلّ بصماته/, "لا زرَّ لعرض بصمات الفنيّ");
  });

  test("🕐 الأوقاتُ تُعرَض بتوقيت بغداد لا بتوقيت الجهاز", () => {
    // القيَمُ تُخزَّن UTC؛ وحاسبةٌ بمنطقةٍ خاطئةٍ (أو خادمٌ UTC) تُظهر البصمةَ منحرفةً
    // ثلاثَ ساعات — فيبدو الحاضرُ متأخّراً والمتأخّرُ منصرفاً.
    const src = read(PAGE);
    assert.match(src, /timeZone: "Asia\/Baghdad"/, "الوقتُ يُعرَض بتوقيت الجهاز لا بغداد");
  });

  test("🔒 العزلُ من الخادم: المسارُ يقصر على مكاتب الوكيل ويرفض مكتبَ غيره", () => {
    const api = read("src/app/api/field/attendance/route.ts");
    assert.match(api, /agentTowerIds\(session\)/, "لا تحديدَ لمكاتب الوكيل");
    assert.match(api, /لا يمكنك عرض حضور مكتب آخر/, "لا رفضَ لمكتبٍ لا يتبع الوكيل");
    // والقائمةُ نفسُها مقصورةٌ على مكاتب الوكيل حين لا يُحدَّد مكتب
    assert.match(api, /towerId: \{ in: agentTowers\.length \? agentTowers : \[-1\] \}/, "قائمةُ الفنيّين غيرُ مقصورةٍ على الوكيل");
    // 🔑 و«لا مكاتبَ» ⇒ `[-1]` لا قائمةٌ فارغة: الفارغةُ في بريزما تعني **بلا شرط** ⇒ كلُّ الفنيّين
    assert.equal(/towerId: \{ in: agentTowers \}/.test(api), false, "قائمةٌ فارغةٌ بلا حارسٍ تُلغي الشرطَ فتكشف الكلّ");
  });

  test("اسمُ المكتب يُرجَع مع كلّ فنيّ — الشاشةُ تجمع كلَّ المكاتب", () => {
    const api = read("src/app/api/field/attendance/route.ts");
    assert.match(api, /office: t\.towerId != null \? \(oNames\.get\(t\.towerId\) \?\? null\) : null/, "لا اسمَ مكتبٍ في الردّ");
    assert.match(read(PAGE), /\{t\.office \?\? "—"\}/, "الشاشةُ لا تعرض المكتب");
  });

  test("الصلاحيّةُ والرابط: الزرُّ موجودٌ والشاشةُ تحرس نفسَها", () => {
    assert.match(read("src/components/shell/AppShell.tsx"), /href: "\/attendance"/, "لا زرَّ يفتح الشاشة");
    const src = read(PAGE);
    // حرسُ الصفحة لا يكفيه إخفاءُ الزرّ: العنوانُ يُكتَب مباشرةً
    assert.match(src, /!can\("field\.manage"\) && !can\("field\.payroll"\)/, "الصفحةُ بلا حرسِ صلاحيّة");
  });
});
