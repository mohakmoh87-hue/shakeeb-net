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
  test("واجباتُه صارت ستّةً وثلاثين فحصاً — لا ستّةً", () => {
    const src = read(HEALTH);
    const n = (src.match(/checks\.push\(\{|await add\(/g) ?? []).length;
    assert.ok(n >= 36, `عددُ الفحوص ${n} — أقلُّ من السّتّة والثلاثين`);
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

  test("🔴 «الحَجزُ العالق» أُسقط — فلا ضررَ ولا زرَّ فكٍّ موجودٌ أصلاً", () => {
    const src = read(HEALTH);
    // الفحصُ كان يُنذر عن طابعٍ يتجاوزه الكودُ بعد خمس دقائق، ويُرسل المالكَ إلى زرٍّ لا يوجد
    assert.equal(src.includes('await add("card_stuck_reservation"'), false,
      "أُعيد فحصُ الحَجز العالق — وهو إنذارٌ بلا ضررٍ ونصيحتُه كاذبة");
    assert.ok(src.includes("staleBefore"), "لا يذكر السببَ (الحجزُ ينتهي بخمس دقائق) فيُعاد الخطأ");
  });

  test("🔴 لا قسمَ منفصلاً للكروت المحذوفة — كلُّ شيءٍ في صفحة الحارس (قرارُ محمد)", () => {
    const page = read("src/app/(app)/manager-accounts/page.tsx");
    assert.equal(page.includes("CardGuardPanel"), false, "بقي القسمُ المنفصلُ الذي رفضه محمد");
    const btn = read(BTN);
    // التنبيهُ بالسيريال وشرحُ الحالة وأزرارُ الإرجاع — في نفس الصفحة
    assert.ok(btn.includes('x.rowKey.startsWith("dcard:")'), "لا أزرارَ إرجاعٍ داخل صفحة الحارس");
    assert.ok(btn.includes("أعِدْه للمخزن"), "لا زرَّ إرجاعٍ للمخزن");
    assert.ok(btn.includes("/api/manager/card-guard"), "الأزرارُ لا تنادي مسارَ حارس الكروت");
    const h = read(HEALTH);
    assert.ok(/rowKey: `dcard:/.test(h), "حالاتُ الكروت المحذوفة بلا هويّةٍ تعرفها الأزرار");
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

// ═══════ ⚖️ مبدأُ «زوالِ الأثر» + و-٢ إرجاعُ بضاعةِ الفاتورة (2026-08-14) ═══════
describe("⚖️ الحارسُ يقيس الأثرَ الباقي لا لحظةَ الحادثة", () => {
  test("🔴 المدّةُ المقلوبةُ لا تُبلَّغ إن نال المشتركُ أيّامَه (حالةُ مروان)", () => {
    const src = read(HEALTH);
    const blk = src.slice(src.indexOf('add("entry_bad_duration"'), src.indexOf('add("entry_days_no_money"'));
    // شرطُ الضرر الباقي: انتهاءُ المشترك على صفّه لا يبلغ نهايةَ ما دُفع مقابلَه
    assert.ok(/s\."dateTo" < e\."dateTo"/.test(blk),
      "الفحصُ يقرأ صفَّ الحادثة وحدَه — فيُنذر عن مشتركٍ نال خدمتَه (قِيس ١٥ من ١٥)");
    assert.ok(/JOIN subscribers s/.test(blk), "لا وصلَ بصفّ المشترك فلا سبيلَ لقياسِ الضرر");
  });

  test("🔴 الكارتُ لا يُبلَّغ إن ذُكر سيريالُه في وصلٍ بأيّ تاريخ (تصحيحٌ متأخّر)", () => {
    const src = read(HEALTH);
    const blk = src.slice(src.indexOf('add("card_used_no_receipt"'), src.indexOf('add("card_used_zero_price"'));
    assert.ok(/e2\.card2 = r\.serial/.test(blk), "لا يرى التصحيحَ اليدويَّ المتأخّر");
  });

  test("🔴 «مدّةٌ بلا مال» لا تُبلَّغ إن جاء قيدُ الصندوق لاحقاً", () => {
    const src = read(HEALTH);
    const blk = src.slice(src.indexOf('add("entry_days_no_money"'), src.indexOf('add("entry_double_minute"'));
    assert.ok(/money_tx m WHERE m\."sourceId" = e\.id/.test(blk), "لا يرى المالَ إن سُجِّل لاحقاً");
  });

  test("🔑 و-٢ · إرجاعُ بضاعةِ الفاتورة في **دالّةٍ واحدةٍ** يستدعيها كلُّ مسارٍ يحذف فاتورة", () => {
    const lib = read("src/lib/invoiceReverse.ts");
    assert.ok(lib.includes("count: { increment:"), "الدالّةُ لا تُرجع الكميّةَ للمخزن");
    assert.ok(lib.includes("custody"), "الدالّةُ لا تُرجع الكميّةَ لذمّة الفنيّ");
    for (const rel of ["src/app/api/invoices/[id]/void/route.ts", "src/app/api/money/[id]/void/route.ts"]) {
      assert.ok(read(rel).includes("reverseInvoiceStock("), `مسارٌ يحذف فاتورةً بلا إرجاعِ بضاعة: ${rel}`);
    }
  });

  test("🔴 ولا يبقى مسارٌ يحذف فاتورةً بسطرٍ واحدٍ بلا إرجاع", () => {
    const walkAll = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walkAll(rel, out); else if (/\.ts$/.test(e.name)) out.push(rel);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const rel of walkAll("src/app/api")) {
      const lines = read(rel).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\binvoice\.update(Many)?\(/.test(line)) return;
        // الحذفُ الناعمُ للفاتورة: يجب أن يسبقه **في نفس المسار** نداءُ الإرجاع.
        // ⚠️ ونافذةُ الأسطر لا تكفي: في مسارِ إبطالِ الفاتورة يقع النداءُ قبل الحذف
        //   بستّةٍ وثلاثين سطراً (بينهما إرجاعُ الصندوق والدَّين) — فالمقياسُ «قبله في
        //   الملفّ» لا «قريباً منه»، وهذا ما تصفه القاعدةُ فعلاً.
        const win = lines.slice(i, i + 3).join("\n");
        if (!/isDeleted: true/.test(win)) return;
        // ♻️ **استرجاعٌ لا حذف**: مسارُ «سجل الوصولات المحذوفة» يكتب `data: { isDeleted: false }`
        //   وشرطُ `where: { isDeleted: true }` عنده يعني «لا تُرجِع إلّا المحذوف» — عكسَ الحذف
        //   تماماً. فالمقياسُ ما تكتبه `data` لا ما ترشِّحه `where`، والقاعدةُ تبقى قاطعةً
        //   على كلّ حذفٍ حقيقيّ.
        if (/data:\s*\{[^}]*isDeleted:\s*false/.test(win)) return;
        const before = lines.slice(0, i).join("\n");
        if (!before.includes("reverseInvoiceStock")) offenders.push(`${rel}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, [],
      `حذفُ فاتورةٍ بلا إرجاعِ بضاعةٍ — نفسُ علّةِ ٢٠٢٦-٠٨-١٤:\n  - ${offenders.join("\n  - ")}`);
  });
});

describe("⚖️ العمليّةُ تُقاس لا الصفُّ (وصل #٣٠٧٥ · ليث ستار)", () => {
  test("🔴 تفعيلٌ كُتب وصلَين في يومٍ واحدٍ والمالُ على أحدهما — سليمٌ فلا يُبلَّغ", () => {
    const src = read(HEALTH);
    const blk = src.slice(src.indexOf('add("entry_days_no_money"'), src.indexOf('add("entry_double_minute"'));
    // شرطُ التوأم: وصلٌ أخٌ لنفس المشترك في نفس اليوم يحمل مالاً أو دَيناً
    assert.ok(/z\."subscriberId" = e\."subscriberId"/.test(blk), "لا فحصَ للوصل الأخ");
    assert.ok(/z\.date::date = e\.date::date/.test(blk), "التوأمُ غيرُ محدودٍ بنفس اليوم");
    assert.ok(/coalesce\(z\."moneyIn",0\) > 0 OR coalesce\(z\.money,0\) > 0/.test(blk),
      "لا يُقبَل الدَّينُ على التوأم — والدَّينُ ليس خطراً");
  });

  test("🔑 والفحوصُ التي تقرأ صفّاً واحداً تُعلَن صريحةً — فلا تتكرّر العلّةُ صامتة", () => {
    const src = read(HEALTH);
    // ثلاثةُ فحوصٍ صار لها شرطُ «الأثرِ الباقي» أو «العمليّة»: المدّة · الكارت · المدّةُ بلا مال
    for (const marker of ['s."dateTo" < e."dateTo"', "e2.card2 = r.serial", 'z.date::date = e.date::date']) {
      assert.ok(src.includes(marker), `شرطٌ غائب: ${marker}`);
    }
  });
});

// ═══════ 🔍 «أين الكارت؟» — الحارسُ يفحص بنفسه قبل أن يُعطي الحالة ═══════
describe("🔍 فحصُ الكروت في الساس", () => {
  test("🔴 سيريالٌ في تفعيلَين لمشتركَين — يُقاس بلا ساسٍ أصلاً", () => {
    const src = read(HEALTH);
    assert.ok(src.includes('"card_serial_reused"'), "لا فحصَ لسيريالٍ مُعادِ الاستخدام");
    const blk = src.slice(src.indexOf('add("card_serial_reused"'));
    assert.ok(/HAVING count\(DISTINCT e\."subscriberId"\) > 1/.test(blk), "لا شرطَ لمشتركَين مختلفَين");
    assert.ok(/severity: "critical"/.test(blk.slice(0, 1600)), "الحالةُ ليست حرجةً وهي قبضٌ مرّتَين");
  });

  test("🔑 حالاتُ الساس تُقرأ من **جدول الفحص** لا من الساس مباشرةً في مسارِ المستخدم", () => {
    const src = read(HEALTH);
    for (const k of ['"card_sas_mismatch"', '"card_stock_used_in_sas"']) {
      assert.ok(src.includes(k), `فحصٌ غائب: ${k}`);
    }
    assert.ok(src.includes("card_sas_checks"), "لا يقرأ جدولَ الفحص");
    assert.equal(src.includes("sasSearchActivation"), false,
      "يُنادي الساسَ من داخل اللوحة — فتتجمّد الصفحةُ ١.٥ث لكلّ كارت");
  });

  test("⛔ ولا مسحَ دوريّاً للكروت — يزيد الفاتورة والمزامنةُ تفحصها يوميّاً (قرارُ محمد)", () => {
    const sch = read("src/lib/scheduler.ts");
    assert.equal(sch.includes("sweepCardSasChecks"), false,
      "أُعيد المسحُ الدوريُّ — ~٤٣٠٠ نداءَ ساسٍ يوميّاً لمعلومةٍ تُنتجها المزامنةُ مجّاناً");
    assert.ok(/يزيد الفاتورة/.test(sch), "لا يذكر السببَ في الملفّ فيُعاد الخطأ");
    // والفحصُ الموجَّهُ عند الحذف باقٍ — وهو المكانُ الصحيح
    assert.ok(read("src/lib/cardDeleteGuard.ts").includes("sasSearchActivation"), "ضاع الفحصُ عند الحذف");
  });

  test("🔒 والحكمُ يُقارن الـrealm أيضاً — فـ@mu ليس @res", () => {
    const sw = read("src/lib/cardSasCheck.ts");
    assert.equal(/\.split\("@"\)/.test(sw), false, "يقصّ الـrealm فيُخفي كارتاً ذهب لوكيلٍ آخر");
    assert.ok(/trim\(\)\.toLowerCase\(\) === /.test(sw), "المقارنةُ غيرُ مطبَّعة");
  });

});

describe("ب-٧ · شهرٌ بأقلَّ من سعرِ باقته — بالعمليّة لا بالصفّ", () => {
  test("🔴 المعيارُ بالعمليّة: مجموعُ يومِ التفعيل لا الوصلُ المفرد", () => {
    const src = read(HEALTH);
    assert.ok(src.includes('"entry_underpaid"'), "بندُ النقص غيرُ مبنيّ");
    const blk = src.slice(src.indexOf('add("entry_underpaid"'), src.indexOf('add("subscriber_no_tower"'));
    // تجميعٌ بالمشترك واليوم — وإلّا عاد الإنذارُ الكاذبُ نفسُه (٥ أنصافِ عمليّات)
    assert.ok(/GROUP BY 1, 2/.test(blk), "بلا تجميعٍ بالعمليّة — فتُنذَر أنصافُ العمليّات");
    assert.ok(/e\.date::date AS d/.test(blk), "التجميعُ ليس بيوم التفعيل");
    assert.ok(/GREATEST\(op\.paid, op\.due\)/.test(blk), "الدَّينُ لا يُحسَب تغطيةً — والدَّينُ ليس خطراً");
    assert.ok(/op\.days >= 25/.test(blk), "بلا شرطِ شهرٍ كامل — فالتفعيلاتُ الجزئيّةُ تُنذَر ظلماً");
  });

  test("والزيادةُ **لا تُبلَّغ** — فلا معيارَ مُثبَتاً للألف", () => {
    const src = read(HEALTH);
    const blk = src.slice(src.indexOf('add("entry_underpaid"'), src.indexOf('add("subscriber_no_tower"'));
    assert.equal(/> p\."priceDinar"/.test(blk), false, "يُنذر عن الزيادةِ أيضاً — و٤٢٧ منها بلا تفسير");
    assert.ok(/الزيادةُ لا تُبلَّغ/.test(blk), "لا يُصرّح بأنّ الزيادةَ متروكةٌ عن قصد");
  });
});
