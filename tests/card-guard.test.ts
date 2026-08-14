import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ 🛡️ حارسُ المال · «فلا يكون هنالك مرورٌ لكارتٍ محذوفٍ بلا فحص الحارس له» ═══════
//
// هذا الملفُّ يجعل شرطَ محمد **قاعدةً يحرسها اختبار** لا وعداً في مراجعة. فأيُّ مسارِ حذفٍ
// جديدٍ يُكتَب غداً ويتخطّى اللقطةَ **يُفشل `npm test`** قبل أن يصل الإنتاج.
//
// 🔴 والحاجةُ مقيسة: ٧٤ كارتاً حقيقيّاً (٣٥٬٠٠٠ للواحد، مالٌ مقبوض) حُذفت بحكمٍ خاطئ،
//   ولم يُمكن إثباتُها إلّا بقائمةِ سيريالاتٍ من محمد — لأنّ السجلَّ كتب **مُعرِّفاتٍ**
//   والصفوفُ محذوفة. فالمُعرِّفُ بعد الحذف رقمٌ لا يدلّ على شيء.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
};

describe("🛡️ حارسُ المال · الكروتُ المحذوفة", () => {
  test("🔴 كلُّ حذفِ كارتٍ في المستودع مسبوقٌ بلقطةِ الحارس — بلا استثناء", () => {
    const offenders: string[] = [];
    for (const rel of walk("src")) {
      if (rel === "src/lib/cardDeleteGuard.ts") continue; // الحارسُ نفسُه لا يحذف كروتاً
      const lines = read(rel).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/prisma\.rechargeCard\.delete(Many)?\s*\(/.test(line)) return;
        // اللقطةُ يجب أن تسبق الحذفَ في **نفس** الملفّ وقريباً منه (٤٠ سطراً)
        const before = lines.slice(Math.max(0, i - 40), i).join("\n");
        if (!before.includes("captureCardsBeforeDelete")) {
          offenders.push(`${rel}:${i + 1} — ${line.trim().slice(0, 90)}`);
        }
      });
    }
    assert.deepEqual(offenders, [],
      `مسارُ حذفٍ بلا فحصِ الحارس (شرطُ محمد المطلق):\n  - ${offenders.join("\n  - ")}`);
  });

  test("المساراتُ الثلاثةُ المعروفةُ موصولةٌ فعلاً — فلا يكفي غيابُ المخالف", () => {
    for (const rel of [
      "src/app/api/manager/phantom-cards/route.ts",
      "src/app/api/recharge-cards/bulk-delete/route.ts",
      "src/app/api/recharge-cards/[id]/route.ts",
    ]) {
      const src = read(rel);
      assert.ok(src.includes("captureCardsBeforeDelete("), `بلا لقطة: ${rel}`);
      assert.ok(src.includes("inspectPendingDeletedCards("), `بلا فحصٍ فوريّ: ${rel}`);
    }
  });

  test("⚡ الفحصُ فورَ الحذف — لا دوريّاً فقط (طلبُ محمد)", () => {
    for (const rel of [
      "src/app/api/manager/phantom-cards/route.ts",
      "src/app/api/recharge-cards/bulk-delete/route.ts",
      "src/app/api/recharge-cards/[id]/route.ts",
    ]) {
      const lines = read(rel).split(/\r?\n/);
      const del = lines.findIndex((l) => /prisma\.rechargeCard\.delete(Many)?\s*\(/.test(l));
      const insp = lines.findIndex((l) => /inspectPendingDeletedCards\(/.test(l));
      assert.ok(del >= 0 && insp > del, `الفحصُ ليس بعد الحذف في ${rel}`);
      // وقبل الردّ — وإلّا لم يكن «فوريّاً» بالنسبة للمستخدم
      const ret = lines.findIndex((l, i) => i > insp && /^\s*return NextResponse\.json/.test(l));
      assert.ok(ret > insp, `الفحصُ بعد الردّ في ${rel}`);
    }
  });

  test("🔒 اللقطةُ تسجّل **السيريال** لا المُعرِّفَ وحدَه — وهذا لبُّ الدرس", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    for (const f of ["serial: true", "price: true", "useDate: true", "subscriberId: true"]) {
      assert.ok(g.includes(f), `اللقطةُ لا تحفظ: ${f}`);
    }
  });

  test("🔒 العزل: اللقطةُ والفحصُ محصورانِ بوكيلِ الصفّ", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    // اللقطة: نفسُ شرطِ الحذف
    assert.ok(/agentId != null \? \{ agentId \}/.test(g), "اللقطةُ بلا شرطِ وكيل");
    // الفحص: جلساتُ الساس تُجلَب بـ`agentId` الصفّ — لا لوحاتَ وكيلٍ آخر
    assert.ok(/where: \{ agentId, isDeleted: false \}/.test(g), "جلساتُ الساس غيرُ معزولةٍ بالوكيل");
    assert.ok(g.includes("sessionsFor(row.agentId)"), "الفحصُ لا يستعمل وكيلَ الصفّ");
  });

  test("الأداةُ هي دالّةُ «ربط كارت» المُثبَتة — لا القائمةُ الجماعيّةُ التي كذبت", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(g.includes("sasSearchActivation"), "لا بحثَ موجَّهاً بالسيريال");
    assert.equal(g.includes("sasFetchActivationsSince"), false,
      "يستعمل القائمةَ الجماعيّة — وهي التي أخفت ٧٤ تفعيلاً حقيقيّاً");
  });

  test("🔴 غيابُ الدليل ليس دليلَ غياب: المستخدَمُ غيرُ الموجودِ في الساس لا يُحكَم وهميّاً", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    // لا حكمَ بالوهميّة عند عدم الوجود، والحكمُ يُبلَّغ لا يُدفَن
    assert.ok(g.includes('verdict = "used-not-in-sas"'), "لا حكمَ لِما لم يوجد");
    assert.ok(/critical\+\+/.test(g), "الأحكامُ غيرُ الطبيعيّة لا تُعَدُّ حرجة");
  });

  test("🔴 **ولا حكمَ بلا ساس**: غيرُ المستخدَمِ يُبحَث أيضاً — لا يُفترَض", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    // العلّةُ التي كانت: `if (row.useDate == null) verdict = "unsold"` **قبل** سؤال الساس
    //   ⇒ كلُّ تنظيفِ مخزنٍ مشروعٍ يصير إنذاراً، وكارتٌ مُفعَّلٌ يحسبه البرنامجُ مخزوناً يمرّ.
    const idxSas = g.indexOf("sasSearchActivation(s.base");
    const idxUnused = g.indexOf("row.useDate == null");
    assert.ok(idxSas > 0 && idxUnused > idxSas,
      "يُحكَم على غيرِ المستخدَم قبل سؤال الساس — تنظيفُ المخزن يصير ضجيجاً وأخطرُ حالةٍ تمرّ");
    assert.ok(g.includes('verdict = "sold-unrecorded"'), "لا حكمَ للمُفعَّلِ الذي يحسبه البرنامجُ مخزوناً");
    assert.ok(/غيرُ مستخدَمٍ ولا تفعيلَ له في الساس/.test(g), "المخزونُ الحقيقيُّ لا يُحكَم طبيعيّاً");
  });

  test("🎯 «العمليّةُ كاملةً»: يوزرُ الساس يُقاد إلى وصلِ صاحبه قبل الإنذار (بلاغُ محمد 2026-08-14)", () => {
    // كارتٌ حُذف وهو مُفعَّلٌ في الساس على `bg-36-1-16@res` — ولصاحبه وصلٌ بـ٣٥٬٠٠٠ مقبوضة
    // في اليوم نفسِه. فالعمليّةُ مكتملةٌ وصفرُ ضرر، ومع ذلك أُنذر بـ٣٤٬٧٥٠ واقتُرح «إرجاعٌ
    // للمخزن» — وهو **يصنع** كارتاً وهميّاً (مستهلَكٌ في الساس فلا يُفعَّل ثانيةً).
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(/hit\.username/.test(g), "لا يُقرأ يوزرُ الساس — فلا سبيلَ للوصول إلى المشترك");
    assert.ok(/netUser: uname/.test(g), "اليوزرُ لا يُبحَث به عن المشترك");
    assert.ok(/subscriptionEntry\.findFirst[\s\S]{0,400}subscriberId: sub\.id/.test(g), "لا يُبحَث عن وصلِ صاحب اليوزر");
    assert.ok(/if \(matched\) \{[\s\S]{0,120}verdict = "normal"/.test(g), "التطابقُ التامُّ ما زال يُنذَر عنه");
    // 🔒 والعزل: المشتركُ من مكاتب وكيل الكارت حصراً — لا مطابقةَ بيوزرٍ عابرٍ للوكلاء
    assert.ok(/agentId: row\.agentId/.test(g), "البحثُ باليوزر بلا قيدِ وكيلِ الكارت");
  });

  test("🔗 وزرُّ «إعادةٌ مربوطة» يستدلّ على المشترك من يوزر الساس حين تكون اللقطة بلا مشترك", () => {
    const r = read("src/app/api/manager/card-guard/route.ts");
    assert.ok(/sasInfo\?\.match/.test(r), "لا استخراجَ لليوزر من لقطة الساس — يبقى العلاجُ الوحيدُ إرجاعاً يصنع وهميّاً");
    assert.ok(/linkSubId/.test(r), "الربطُ ما زال مقيَّداً بمشترك اللقطة وحدَه");
    assert.ok(/useDate: row\.useDate \?\? new Date\(\)/.test(r), "الاستعادةُ المربوطةُ قد تُعيده «متاحاً» فتلتقطه المزامنة");
  });

  test("كلُّ حكمٍ يُبلَّغ — والطبيعيُّ مجموعاً والشاذُّ منفرداً", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    // ⚠️ تغيّرت القاعدةُ بتصحيح محمد: الطبيعيُّ لم يبقَ صامتاً بل يُجمَع في تنبيهٍ واحد
    assert.ok(g.includes("normals.push("), "الطبيعيُّ يمرّ صامتاً — فالحذفُ سهواً لا يُكتشَف");
    assert.ok(g.includes("await notify({"), "لا إبلاغَ بالحالة");
    for (const v of ["sold-unrecorded", "no-receipt", "bad-duration", "used-not-in-sas", "error"]) {
      assert.ok(g.includes(`"${v}"`), `حكمٌ بلا نصِّ إبلاغ: ${v}`);
    }
  });

  test("الحَجزُ قبل الأثر: لا يُحكَم ولا يُبلَّغ مرّتَين على صفٍّ واحد", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(/where: \{ id: row\.id, verdict: "pending" \}/.test(g), "التحديثُ بلا شرطِ حَجز");
    assert.ok(g.includes("claimed.count !== 1"), "الإشعارُ لا يتبع نجاحَ الحَجز");
  });

  test("لا يُمنَع الحذفُ إن تعذّرت اللقطة — لكنّه يُسجَّل صريحاً", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(g.includes("CARD_GUARD_CAPTURE_FAILED"), "تعذُّرُ اللقطة يمرّ بلا أثر");
  });

  test("⚠️ مدّةٌ مقلوبةٌ أو صفرٌ تُبلَّغ — والمالُ مقبوضٌ (حالةُ bg-5-23-1@mu)", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(g.includes('verdict = "bad-duration"'), "المدّةُ المقلوبةُ لا تُلتقَط");
    assert.ok(/days <= 0/.test(g), "شرطُ المدّة ليس «صفراً أو أقلّ»");
  });
});

describe("🔔 حتّى الحذفُ الطبيعيُّ يُنبَّه عنه (تصحيحُ محمد 2026-08-14)", () => {
  test("🔴 الطبيعيُّ لا يمرّ صامتاً — يُجمَع في تنبيهٍ واحدٍ للدفعة", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(g.includes("normals.push("), "الطبيعيُّ يُتخطّى بلا تنبيه — فالحذفُ سهواً لا يُكتشَف");
    assert.ok(/type: "card-deleted"/.test(g), "لا تنبيهَ لحذفٍ طبيعيّ");
    // واحدٌ للدفعة لا لكلّ كارت: التنبيهُ خارجَ الحلقة
    const loopEnd = g.indexOf("if (normals.length) {");
    const lastInLoop = g.lastIndexOf("refType: \"deletedCardLog\"");
    assert.ok(loopEnd > lastInLoop, "التنبيهُ داخلَ الحلقة — فحذفُ مئةٍ يعني مئةَ إشعار");
  });

  test("والمبلغُ في التنبيه — فالكارتُ مالٌ لا رقمٌ", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(/total\.toLocaleString/.test(g), "التنبيهُ بلا مبلغ");
    assert.ok(/أعِدْه للمخزن/.test(g), "التنبيهُ لا يدلّ على بابِ الرجوع");
  });

  test("واللوحةُ تُظهر محذوفاتِ الأسبوع بإحاطةٍ لا بإنذار", () => {
    const h = read("src/lib/moneyHealth.ts");
    assert.ok(h.includes('"cards_deleted_recent"'), "لا بندَ للمحذوفات الحديثة");
    const blk = h.slice(h.indexOf('add("cards_deleted_recent"'));
    assert.ok(/severity: "info"/.test(blk.slice(0, 1800)), "الإحاطةُ تُعَدُّ إنذاراً فتُخيف بلا سبب");
    assert.ok(/INTERVAL '7 days'/.test(blk.slice(0, 900)), "بلا نافذةٍ زمنيّةٍ يصير سجلّاً دائماً");
  });
});

describe("🔴 لا يُنسَب إلى الساس نفيٌ وهو لم يُسأل", () => {
  test("تعذُّرُ كلِّ اللوحات ⇒ حكمُ error لا «لا تفعيلَ في الساس»", () => {
    const g = read("src/lib/cardDeleteGuard.ts");
    assert.ok(g.includes("if (list.length === 0) {"), "لا فحصَ لتعذُّر كلّ اللوحات");
    const blk = g.slice(g.indexOf("if (list.length === 0) {"), g.indexOf("if (list.length === 0) {") + 700);
    assert.ok(/verdict = "error"/.test(blk), "يُحكَم طبيعيّاً بلا سؤال الساس");
    assert.ok(/لم يُفحَص/.test(blk), "لا يُصرّح بأنّ الكارتَ لم يُفحَص");
    // والصفُّ يبقى حرجاً فيُعاد فحصُه — لا يُدفَن
    assert.ok(/out\.critical\+\+/.test(blk), "لا يُعَدُّ حالةً فيُنسى");
  });
});
