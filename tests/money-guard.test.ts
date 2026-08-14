import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ 🕵️ حارسُ المال · واجباتُه وتجاهُلُه ومظهرُه (طلبُ محمد 2026-08-14) ═══════
//
// «أريد **كلَّ** هذه البنود أن تكون واجباتِ حارس المال، وأيضاً يمكن تجاهُلُ أيّ حالةٍ
//  منه — وهو خيارٌ من ضمن الخيارات التي يطرحها. وغيِّر اسمَه من سلامة المال إلى
//  حارس المال، بإيموجي كبيرٍ على عرضه: مرتاحٌ وأخضر · عصبيٌّ وبرتقاليّ · غاضبٌ
//  مستعدٌّ وأحمرُ يتوهّج. واحتفِظ بأبعاد المربّع بدون تكبيرها.»
//
// وهذه الاختباراتُ تُثبّت ما لا يُرى في المراجعة: أنّ كلَّ فحصٍ يحمل **طريقةَ حلّ**،
// وأنّ العزلَ في كلّ استعلام، وأنّ الاسمَ القديم لم يبقَ في واجهةٍ يراها محمد.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const HEALTH = "src/lib/moneyHealth.ts";
const BTN = "src/components/MoneyHealthButton.tsx";
const FIG = "src/components/GuardFigure.tsx";

describe("🕵️ حارسُ المال", () => {
  test("واجباتُه صارت أربعةً وثلاثين فحصاً — لا ستّةً", () => {
    const src = read(HEALTH);
    const n = (src.match(/checks\.push\(\{|await add\(/g) ?? []).length;
    assert.ok(n >= 34, `عددُ الفحوص ${n} — أقلُّ من الأربعة والثلاثين`);
  });

  test("🔴 التفعيلُ على الدَّين **ليس خطراً** — تصحيحُ محمد 2026-08-14", () => {
    const src = read(HEALTH);
    const blk = src.slice(src.indexOf('add("card_used_no_receipt"'), src.indexOf('add("card_used_zero_price"'));
    // المعيارُ: **لا وصلَ أصلاً** — لا «لا وصلَ بمبلغٍ مقبوض» (فذاك يظلم كلَّ تفعيلِ دَين)
    assert.equal(/coalesce\(e\."moneyIn",0\) > 0/.test(blk), false,
      "ما زال الفحصُ يشترط مبلغاً مقبوضاً — فيُنذر عن كلّ تفعيلٍ على الدَّين (قِيس ٤٤ من ٥٨)");
    assert.ok(/NOT EXISTS[\s\S]{0,200}subscription_entries/.test(blk), "لا شرطَ لغياب الوصل");
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(g.includes("if (entry) {"), "حارسُ الحذف ما زال يشترط مبلغاً مقبوضاً");
    assert.ok(/على الدَّين/.test(g), "حارسُ الحذف لا يذكر الدَّين في تشخيصه");
  });

  test("🔑 ما جذرُه واحدٌ يُجمَع في حالةٍ واحدة — لا صفٌّ لكلّ كارت", () => {
    const src = read(HEALTH);
    for (const [key, rk] of [["card_used_zero_price", "zerocards:"], ["card_stock_zero_price", "zerostock:"]]) {
      const blk = src.slice(src.indexOf(`add("${key}"`)).slice(0, 900);
      assert.ok(blk.includes(`rowKey: \`${rk}`), `${key} غيرُ مجموعٍ بالفئة`);
      assert.ok(blk.includes("GROUP BY"), `${key} بلا تجميع`);
    }
  });

  test("🔒 بنيةُ القاعدة ليست في لوحةِ الوكيل بل في سكربتِ المالك", () => {
    assert.equal(read(HEALTH).includes("relrowsecurity"), false,
      "فحصُ RLS في لوحةِ الوكيل — وهو ضجيجٌ له وكشفُ داخليّاتٍ في آن");
    assert.ok(read("scripts/check-money-invariants.mjs").includes("relrowsecurity"),
      "فحصُ RLS غائبٌ عن سكربتِ المالك");
  });

  test("🔒 كلُّ فحصٍ معزولٌ بمكاتب الوكيل أو بـagentId — في شرطِ الاستعلام نفسِه", () => {
    const src = read(HEALTH);
    // كلُّ استعلامٍ في هذه الوحدة يجب أن يحمل أحدَ قيدَي العزل
    const queries = src.split(/await q\(`|await add\([^`]*`/).slice(1);
    const naked: string[] = [];
    for (const raw of queries) {
      const sql = raw.slice(0, raw.indexOf("`") >= 0 ? raw.indexOf("`") : raw.length);
      if (!sql.trim() || !/\bFROM\b/i.test(sql)) continue;
      if (!/\$\{T\}|\$\{agentId\}/.test(sql)) naked.push(sql.slice(0, 90).replace(/\s+/g, " "));
    }
    assert.deepEqual(naked, [], `استعلامٌ بلا عزل:\n  - ${naked.join("\n  - ")}`);
  });

  test("كلُّ حالةٍ تحمل طريقةَ حلٍّ مكتوبةً — فالإبلاغُ بلا علاجٍ نصفُ فائدة", () => {
    const src = read(HEALTH);
    const titles = (src.match(/title: /g) ?? []).length;
    const hows = (src.match(/how: /g) ?? []).length;
    assert.equal(titles, hows, `عنواناتٌ ${titles} مقابلَ طرقِ حلٍّ ${hows}`);
  });

  test("🙈 التجاهلُ خيارٌ لكلّ حالة — بهويّةِ صفٍّ ثابتةٍ يُبنى عليها الكتم", () => {
    const src = read(HEALTH);
    assert.equal((src.match(/rowKey: /g) ?? []).length, (src.match(/title: /g) ?? []).length,
      "حالةٌ بلا rowKey لا يمكن تجاهُلُها");
    const btn = read(BTN);
    assert.ok(btn.includes("تجاهل"), "لا زرَّ تجاهُلٍ في اللوحة");
    assert.ok(btn.includes("checkKey: c.checkKey"), "التجاهلُ لا يُرسل مفتاحَ الفحص");
  });

  test("🔑 اليوزراتُ المكرَّرةُ حالةٌ **واحدةٌ جامعة** — ٢٤ صفّاً تعني ٢٤ ضغطةَ تجاهُلٍ لأمرٍ موقوف", () => {
    const src = read(HEALTH);
    assert.ok(src.includes('rowKey: "dupuser:all"'), "حالاتُ اليوزر ليست مجموعةً في صفٍّ واحد");
    assert.ok(/severity: "info"/.test(src), "المكرَّرُ يُنذر بدل أن يكون للعلم");
    assert.ok(src.includes("موقوفٌ بطلبك"), "لا يذكر أنّ الأمرَ موقوفٌ بقرار محمد");
  });

  test("الاسمُ صار «حارسُ المال» ولم يبقَ «سلامة المال» في نصٍّ يراه المستخدم", () => {
    for (const rel of [BTN, FIG]) {
      const src = read(rel);
      const visible = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("//") && l.includes("سلامة المال"));
      assert.deepEqual(visible, [], `بقي الاسمُ القديم في ${rel}`);
    }
    assert.ok(read(BTN).includes("حارسُ المال"), "الاسمُ الجديد غائب");
  });

  test("🎨 الحالاتُ الثلاث: أخضرُ مرتاحٌ · برتقاليٌّ منتبِهٌ · أحمرُ غاضبٌ **يتوهّج**", () => {
    const btn = read(BTN);
    assert.ok(/emerald-\d+ bg-emerald/.test(btn), "لا أخضرَ للحالة السليمة");
    assert.ok(/orange-\d+ bg-orange/.test(btn), "لا برتقاليَّ للحالة غير الحرجة");
    assert.ok(/red-\d+ bg-red/.test(btn), "لا أحمرَ للحالة الحرجة");
    assert.ok(btn.includes('glow: "guard-alarm"'), "الأحمرُ لا يتوهّج");
    const css = read("src/app/globals.css");
    assert.ok(/@keyframes guardAlarmGlow[\s\S]*box-shadow/.test(css), "التوهّجُ ليس بالظلّ");
  });

  test("🎬 الحالاتُ الثلاثُ **كلُّها متحرّكة** — لا واحدةٌ ساكنةٌ كصورة", () => {
    const fig = read(FIG);
    const css = read("src/app/globals.css");
    for (const cls of ["guard-body-calm", "guard-head-calm", "guard-body-warn", "guard-head-warn",
                       "guard-body-rage", "guard-head-rage", "guard-gun-rage"]) {
      assert.ok(fig.includes(cls), `الرسمُ لا يستعمل ${cls}`);
      assert.ok(new RegExp(`\\.${cls}\\s*\\{[^}]*animation:`).test(css), `لا حركةَ معرَّفةً لـ${cls}`);
    }
  });

  test("⚠️ وأبعادُ المربّع لا تُزاد: الحركةُ كلُّها transform ولا scale على المربّع نفسِه", () => {
    const css = read("src/app/globals.css");
    const block = css.slice(css.indexOf("guardAlarmGlow"));
    // التوهّجُ ظلٌّ خارجيّ، ولا تكبيرَ للصندوق (تكبيرُ الوجه داخلَ الرسم لا يمسّ المقاس)
    assert.equal(/\.guard-alarm\s*\{[^}]*scale/.test(block), false, "المربّعُ يتكبّر بالتوهّج");
    assert.ok(/prefers-reduced-motion/.test(css), "لا احترامَ لطلبِ تقليل الحركة");
  });

  test("🧭 الشخصُ يساراً والكتابةُ يميناً (طلبُ محمد ليكبر الشخص)", () => {
    const btn = read(BTN);
    const card = btn.slice(btn.indexOf("البطاقةُ في حسابات المدير"), btn.indexOf("{open &&"));
    assert.ok(/flex cursor-pointer items-center justify-between/.test(card), "البطاقةُ ليست صفّاً أفقيّاً");
    // النصُّ أوّلاً في DOM ⇒ يميناً في RTL، والرسمُ بعده ⇒ يساراً
    assert.ok(card.indexOf("حارسُ المال") < card.indexOf("<GuardFigure"), "الرسمُ قبل النصّ — فيصير يميناً");
    assert.ok(/size=\{56\}/.test(card), "الشخصُ لم يكبر بعد نقلِه إلى اليسار");
  });

  test("🎯 الغاضبُ يغلق فمَه ويقبض المسدّسَ **بكلتا يديه** مصوَّباً إلى الأمام", () => {
    const fig = read(FIG);
    const rage = fig.slice(fig.indexOf("critical: {"), fig.indexOf("};", fig.indexOf("critical: {")));
    assert.ok(/mouthFill: "none"/.test(rage), "الفمُ مملوءٌ — أي مفتوح");
    assert.ok(/pose: "aim"/.test(rage), "الوقفةُ ليست تصويباً");
    const aim = fig.slice(fig.indexOf('m.pose === "listen"'));
    // كفّان لا كفٌّ واحدة
    assert.equal((aim.match(/cx="45\.4"|cx="54\.6"/g) ?? []).length, 2, "ليست كفَّين على المقبض");
    assert.ok(aim.includes('cx="50" cy="63.6"'), "لا فوهةَ تنظر إلى الأمام");
  });

  test("⚠️ ترتيبُ الطبقات: الذراعانِ **بعد** الرأس وإلّا حُجب المسدّس", () => {
    const fig = read(FIG);
    assert.ok(fig.indexOf('cy="45" r="30"') < fig.indexOf('m.pose === "hips"'),
      "الذراعانِ تُرسَمانِ قبل الرأس — فيقع المسدّسُ خلف قُبّته ويُحجَب");
  });

  test("🔴 وصلةُ حارسِ الحذف بلوحةِ الحارس — فلا حكمٌ يُدفَن في جدولٍ لا يُرى", () => {
    const src = read(HEALTH);
    assert.ok(src.includes("deleted_card_logs"), "أحكامُ الكروت المحذوفة لا تظهر في اللوحة");
    assert.ok(src.includes('"deleted_card_verdicts"'), "لا فحصَ لحالات الحذف");
    assert.ok(/handledAt" IS NULL/.test(src), "تظهر حالاتٌ عُولجت سابقاً");
  });

  test("🛡️ البنودُ الماليّةُ الكبرى موجودةٌ فعلاً بمفاتيحها", () => {
    const src = read(HEALTH);
    for (const key of ["card_used_no_receipt", "card_used_zero_price", "entry_bad_duration",
                       "invoice_deleted_tx_live", "invoice_item_orphan", "salary_negative_net",
                       "entry_double_minute", "item_negative_count", "subscriber_no_tower"]) {
      assert.ok(src.includes(`"${key}"`), `بندٌ غائب: ${key}`);
    }
  });
});
