import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٣ · صورةُ القالب تصل فعلاً — ولا يسقط قالبٌ من السلسلة ═════
//
// طلبُ محمد: «صورةٌ تصل مع الرسالة **ولأيّ قالبٍ أختاره**». و«أيُّ قالب» هي كلُّ المسألة:
// السلسلةُ خمسُ حلقات (قالب ← `getEffectiveTemplateFull` ← `sendViaProvider` ← `sendWhatsApp`
// ← `MessageMedia`)، وكلُّ موضعِ إرسالٍ يمرّ بها **وحدَه**. فمَن نسي حلقةً في موضعٍ واحدٍ
// لم يُخطئ عند `tsc` (فالوسيطُ اختياريّ) ولم يُخطئ عند التشغيل (فالرسالةُ تُرسَل نصّاً)
// — تسقط الصورةُ **بصمتٍ** لقالبٍ واحد، ويكتشفه محمد بعد أسبوعٍ من إرسالٍ ناقص.
//
// ⇒ فالحرسُ هنا **بنيويٌّ لا حالة**: يمسح كلَّ موضعٍ يستهلك قالباً ثمّ يُرسل، ويُلزمه
//   بتمريرِ الصورة. وأيُّ قالبٍ يُضاف غداً يخضع للحكم نفسه بلا أن يتذكّره أحد.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** كلُّ ملفّات `src` — للمسح البنيويّ. */
function allSources(dir = path.join(ROOT, "src")): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...allSources(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("البند ٣ · صورةُ القالب", () => {
  test("كلُّ موضعٍ يستهلك قالباً ثمّ يُرسل — يُمرّر الصورة", () => {
    const offenders: string[] = [];
    for (const file of allSources()) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      // موضعُ الإرسالِ القالبيّ = يستهلك القالبَ **ويُرسل**. ومَن يقرأ القالبَ للعرض
      // (كمسار `effective` الذي يُعيده للواجهةِ معاينةً) لا إرسالَ فيه فلا صورةَ تلزمه.
      const usesTemplate = /getEffectiveTemplate(Full)?\s*\(/.test(src);
      const sends = /sendViaProvider\s*\(/.test(src);
      if (!usesTemplate || !sends) continue;

      // ١) لا يجوز البقاءُ على النسخة العمياء إن كان الملفُّ يُرسل
      if (/getEffectiveTemplate\s*\(/.test(src)) {
        offenders.push(`${rel}: ما زال ينادي getEffectiveTemplate (بلا صورة) وهو يُرسل`);
        continue;
      }
      // ٢) وكلُّ نداءِ إرسالٍ **قالبيٍّ** فيه يمرّر وسيطاً خامساً (الصورة).
      //   🔑 والحكمُ لكلّ نداءٍ لا لكلّ ملفّ: `scheduler.ts` يُرسل تقريرَ المدير أيضاً
      //   وهو نصٌّ **مبنيٌّ لا قالبيّ** (`dailyReportText`) — فلا قالبَ له ولا صورةَ تلزمه،
      //   وإلزامُه بها يجعل الحرسَ يكذب فيُسكَت. فالمِعيارُ: هل نصُّ الرسالةِ خرج من
      //   `renderTemplate`؟ فإن كان، فالقالبُ حاضرٌ وصورتُه معه.
      //   ⚠️ ولا يكفي جمعُ الأسماء المُشتقّة من `renderTemplate` في مجموعةٍ واحدة: اسمُ
      //   `text` يتكرّر في **ثلاث** دوالَّ من `scheduler.ts`، اثنتان قالبيّتان والثالثةُ
      //   تقريرُ المدير — فمجموعةٌ واحدةٌ تخلط النطاقاتَ وتُدين البريءَ. فالحكمُ بأقربِ
      //   إسنادٍ **سابقٍ** للاسم نفسِه: هو النطاقُ الذي يُرى فعلاً عند النداء.
      const assignedFrom = (name: string, upto: number): string => {
        const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=([^;\\n]*)`, "g");
        let last = "";
        for (const a of src.matchAll(re)) { if (a.index! > upto) break; last = a[1]; }
        return last;
      };
      for (const m of src.matchAll(/sendViaProvider\s*\(([^;]*?)\)\s*[;.\n]/g)) {
        const args = m[1];
        // تقسيمُ الوسائط على المستوى الأعلى
        const parts: string[] = [];
        let depth = 0, cur = "";
        for (const ch of args) {
          if (ch === "(" || ch === "[" || ch === "{") depth++;
          else if (ch === ")" || ch === "]" || ch === "}") depth--;
          if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
          cur += ch;
        }
        parts.push(cur);
        const body = (parts[2] ?? "").trim();
        if (!/^\w+$/.test(body)) continue;
        if (!/renderTemplate\s*\(/.test(assignedFrom(body, m.index!))) continue; // نصٌّ مبنيٌّ لا قالبيّ
        if (parts.length < 5) offenders.push(`${rel}: نداءُ sendViaProvider القالبيّ (${body}) بلا وسيطِ الصورة`);
      }
    }
    assert.deepEqual(offenders, [], `مواضعُ إرسالٍ قالبيٍّ تسقط منها الصورة:\n  - ${offenders.join("\n  - ")}`);
  });

  test("المُجدول (تذكيرُ الانتهاء والديون) يقرأ النصَّ والصورةَ معاً", () => {
    const src = read("src/lib/scheduler.ts");
    assert.match(src, /getEffectiveTemplateFull/, "المُجدولُ ما زال على النسخة العمياء");
    // بحثاً عن الخلط: `renderTemplate(template` بلا `.text` يبني نصَّ الرسالةِ من **كائن**
    // فيُخرج "[object Object]" إلى المشترك — ولا يُخطئ عند tsc إن كان الوسيطُ فضفاضاً.
    assert.equal(/renderTemplate\(template\s*,/.test(src), false, "renderTemplate يأخذ الكائنَ لا نصَّه");
    assert.equal((src.match(/renderTemplate\(template\.text/g) ?? []).length, 2, "المُرسِلان (انتهاء + ديون) كلاهما على .text");
  });

  test("سقفُ حجم الصورة محروسٌ على الخادم لا على الواجهة وحدَها", () => {
    const api = read("src/app/api/sms-templates/bulk/route.ts");
    assert.match(api, /IMAGE_MAX_CHARS/, "لا سقفَ على الخادم");
    assert.match(api, /image:\s*z\.string\(\)\.max\(IMAGE_MAX_CHARS/, "السقفُ غيرُ مربوطٍ بحقل الصورة في المخطَّط");
    // والواجهةُ تحرسه أيضاً — لكنّها **ليست** الحرسَ الوحيد
    assert.match(read("src/app/(app)/sms-templates/page.tsx"), /IMAGE_MAX_BYTES/, "لا سقفَ في الواجهة");
  });

  test("صورةٌ لم تُلمَس لا تُرسَل — فلا تُنسَخ صورةُ الوكيل إلى صفّ المكتب", () => {
    // 🔑 العلّةُ التي يحرسها هذا: لو أرسلت الواجهةُ الصورةَ **المعروضة** دائماً، لَنسخ
    //   أوّلُ حفظٍ لنصِّ المكتبِ صورةَ الوكيل إلى صفّ المكتب — فانفصلت عنه ولم تتبع
    //   تحديثَه بعدُ أبداً. فيُبدّل الوكيلُ شعارَه وتبقى مكاتبُه على الشعار القديم صامتةً.
    const page = read("src/app/(app)/sms-templates/page.tsx");
    assert.match(page, /imageDirty/, "لا رايةَ «لُمِست» — الصورةُ تُرسَل في كلّ حفظ");
    assert.match(page, /t\.imageDirty\s*\?\s*\{\s*image:/, "الإرسالُ غيرُ مشروطٍ بلمسِ الصورة");
    // والخادمُ يُكرم الغياب: `image: undefined` في بريزما تعني «لا تمسّها»
    const api = read("src/app/api/sms-templates/bulk/route.ts");
    assert.match(api, /t\.image === undefined \? \{\} :/, "الخادمُ يكتب الصورةَ حتى عند غياب الحقل");
  });

  // ═════ 🧾 «لا تُحفَظ الصورةُ في أيّ سجلٍّ» (طلبُ محمد 2026-08-13) ═════
  // «الصورُ أحجامُها تضرّ عملي وتُغلي الفاتورة». والسجلُّ يُكتب **لكلّ رسالة** — فصورةٌ
  // في السجلّ تعني نسخةً لكلّ مشترك، والقالبُ الواحدُ يكفيه أصلٌ واحدٌ إلى الأبد.
  describe("الصورةُ لا تُخزَّن في أيّ سجلٍّ للرسائل", () => {
    test("جدولُ الرسائل بلا عمودِ صورةٍ أصلاً — ولا يُضاف", () => {
      const schema = read("prisma/schema.prisma");
      const model = /^model Message \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
      assert.notEqual(model, "", "نموذجُ Message غيرُ موجود");
      assert.equal(/^\s*image\b/m.test(model), false,
        "أُضيف عمودُ صورةٍ إلى سجلّ الرسائل — نسخةٌ لكلّ رسالةٍ مُرسَلة، وهو عينُ ما رفضه محمد");
      // ولا حقلَ وسائطَ آخرَ بالمعنى نفسِه
      assert.equal(/^\s*(media|attachment|imageData|photo)\b/m.test(model), false, "حقلُ وسائطَ في سجلّ الرسائل");
    });

    test("النازعُ يُفرّغ ٤٠٠ ك.ب ويُبقي التشخيص — قياسٌ سلوكيٌّ لا مطابقةُ نصّ", async () => {
      const { scrubRelayImage } = await import("../src/lib/relayScrub");
      const img = "data:image/png;base64," + "A".repeat(400_000);
      const before = JSON.stringify({ phone: "07701234567", text: "مرحباً", image: img });
      const after = scrubRelayImage(before)!;
      const o = JSON.parse(after) as Record<string, unknown>;
      assert.equal(o.image, null, "الصورةُ باقيةٌ في الصفّ");
      assert.ok(after.length < 200, `الصفُّ ما زال ضخماً: ${after.length} حرفاً`);
      assert.equal(o.phone, "07701234567", "ضاع رقمُ الهاتف من التشخيص");
      assert.equal(o.text, "مرحباً", "ضاع نصُّ الرسالة من التشخيص");
      assert.match(String(o.imageSent), /^\d+KB$/, "لا أثرَ يُخبر أنّ صورةً أُرسلت وحجمَها");
      // والأمانُ: لا يُتلِف ما لا يفهمه ولا ما لا صورةَ فيه
      assert.equal(scrubRelayImage(null), null);
      assert.equal(scrubRelayImage('{"phone":"1"}'), '{"phone":"1"}', "مُسَّ صفٌّ بلا صورة");
      assert.equal(scrubRelayImage('{"image":"x"'), '{"image":"x"', "نصٌّ معطوبٌ أُتلِف بدل أن يُترَك");
    });

    test("صفُّ الترحيل تُنزَع منه الصورةُ لحظةَ التنفيذ لا بعد خمس دقائق", () => {
      const wa = read("src/lib/whatsapp.ts");
      assert.match(wa, /scrubRelayImage/, "لا نازعَ للصورة من صفّ الترحيل");
      // والنزعُ في **مساري** النجاح والفشل كليهما — فالفاشلُ لا يُعاد تنفيذُه أصلاً
      // نافذةٌ من نصّ كلّ نداء — ولا تُقتنَص بـ`[^}]*` فـ`where: { id }` يحمل `}` يقطعه
      const statusWrites = [...wa.matchAll(/waRelay\.update\(/g)]
        .map((m) => wa.slice(m.index!, m.index! + 320))
        .filter((w) => /status:\s*"(done|error)"/.test(w));
      assert.ok(statusWrites.length >= 5, `مواضعُ إنهاءِ الترحيل أقلُّ من المتوقَّع: ${statusWrites.length}`);
      const unscrubbed = statusWrites.filter((w) => !/params:\s*scrubRelayImage/.test(w));
      assert.deepEqual(unscrubbed.map((w) => w.slice(0, 90)), [], "موضعُ إنهاءِ ترحيلٍ يُبقي الصورةَ في params");
    });

    test("تبديلُ صورةِ القالب يستردّ مساحةَ القديمة فوراً", () => {
      const api = read("src/app/api/sms-templates/bulk/route.ts");
      assert.match(api, /VACUUM \(ANALYZE\) sms_templates/, "لا استرجاعَ للمساحة بعد تبديل الصورة");
      assert.match(api, /if \(imageTouched\)/, "الاسترجاعُ غيرُ مشروطٍ بلمسِ صورةٍ (يُثقل كلَّ حفظٍ للنصّ)");
      // 🔑 وأفضلُ جهدٍ لا شرطُ نجاح: VACUUM يحتاج ملكيّةَ الجدول — فسقوطُه لا يُسقط حفظَ محمد
      assert.match(api, /VACUUM[\s\S]{0,120}\.catch\(/, "فشلُ VACUUM يُسقط الحفظَ — ودورُ العامل ليس مالكَ الجدول");
    });
  });

  test("واتساب: صورةٌ ونصٌّ رسالةٌ واحدة، وفشلُ الصورة لا يُسقط النصّ", () => {
    const wa = read("src/lib/whatsapp.ts");
    assert.match(wa, /caption:\s*text/, "الصورةُ تُرسَل بلا تعليقٍ ⇒ رسالتان للمشترك");
    // والسقوطُ الآمن: كتلةُ الصورةِ داخل try خاصٍّ بها، وبعدها إرسالُ النصّ
    const block = wa.slice(wa.indexOf("if (image) {"));
    assert.match(block.slice(0, 700), /catch[\s\S]*client\.sendMessage\(waId, text\)/, "فشلُ الصورة يُسقط الرسالةَ كلَّها");
    // والمُرحِّلُ يحمل الصورةَ إلى حاسبة المكتب (المُرسِلُ هي لا السحابة)
    assert.match(wa, /"sendMsg",\s*\{\s*phone,\s*text,\s*image:/, "المُرحِّلُ لا يحمل الصورة");
    assert.match(wa, /p\.image\s*\?\?\s*null/, "مُستقبِلُ الترحيل يُهمل الصورة");
  });
});
