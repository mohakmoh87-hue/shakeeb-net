import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";

// ═════ ب-١/الأصل ٣ · حارسُ النسخة الواحدة ═════
// حادثةُ الأصل: عاملان على حاسبةٍ واحدةٍ ⇒ تذكيرُ المشتركين ونسخةُ القاعدة ومزامنةُ SAS
// **مرّتَين**، و`killOrphanBrowsers` في الثاني **يقتل متصفّحاتِ الأوّل** فتُفقَد جلساتُ
// الواتساب (حادثةُ مكتب المواصلات).
//
// والعلّةُ لم تكن في وجود الحارس بل في **ترتيبه**: كان الحجزُ الفعليُّ للمنفذ آخرَ الأشياء،
// وقبله مِسبارٌ يُغلق المنفذَ فوراً — فالخاسرُ يقتل ويُجدول **ثمّ** يعرف أنّه خاسر.
//
// ⇒ فهذا الاختبارُ يحرس **الترتيب** نصّاً، لأنّه هو ما انكسر. أيُّ تحريرٍ لاحقٍ يُقدّم
// أثراً على القفل يُسقط الاختبار. ولا يُغني عنه اختبارُ سلوكٍ: تشغيلُ عاملٍ ثانٍ حقيقيٍّ
// للتجربة هو **عينُ الحادثة** التي نمنعها.

const read = (p: string) => fs.readFileSync(p, "utf8");

/** موضعُ أوّل ظهورٍ لنصٍّ، أو `Infinity` إن غاب — ليصحّ التقديمُ بالمقارنة مباشرةً. */
function at(src: string, needle: string): number {
  const i = src.indexOf(needle);
  return i === -1 ? Infinity : i;
}

/** جسمُ الإقلاع وحدَه — فترتيبُ النداءات هو المقصود، و**تعريفُ** دالّةٍ أعلى الملفّ
 *  ليس تنفيذاً لها (وهو ما أوقع القياسَ أوّلَ مرّة: `function killOrphanBrowsers()`). */
function bootBody(src: string, marker: string): string {
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, `تغيّرت بنيةُ الملفّ: لم يُعثر على «${marker}»`);
  return src.slice(i);
}

describe("حارسُ النسخة الواحدة: لا أثرَ قبل القفل", () => {
  test("worker.ts — القفلُ قبل قتلِ المتصفّحات وقبل المُجدول", () => {
    const src = bootBody(read("src/worker.ts"), "(async () => {");
    const lock = at(src, 'await startLocalSasServer("exit")');
    assert.notEqual(lock, Infinity, "غاب القفلُ من العامل — أو تغيّر نصُّه فلم يُعد محروساً");

    // كلُّ ما يُحدث أثراً خارج العمليّة يجب أن يكون **بعد** القفل
    for (const effect of [
      "killOrphanBrowsers()",  // 🔴 يقتل متصفّحاتِ الرابح
      "startScheduler()",      // 🔴 تذكيرٌ ونسخةٌ احتياطيّةٌ مرّتَين
      "startHybridAgent()",
      "startWaRequestPoller()",
      "startWaRelayPoller()",
      "startPrintAgent()",
      "startOdooSync()",
      "bootConfigCheck()",
    ]) {
      assert.ok(
        at(src, effect) > lock,
        `${effect} يُنفَّذ **قبل** القفل — هذه هي العلّةُ نفسُها التي أهدرت جلساتَ الواتساب`,
      );
    }
  });

  test("instrumentation.ts — القفلُ أوّلاً، وسلوكُ الخاسر تنازلٌ لا خروج", () => {
    const src = bootBody(read("src/instrumentation.ts"), "export async function register");
    const lock = at(src, 'startLocalSasServer("yield")');
    assert.notEqual(lock, Infinity, "خادمُ Next يجب أن يحجز بـ`yield` (لا `exit`) فهو يخدم صفحات");
    for (const effect of ["startScheduler()", "startHybridAgent()", "startWaRequestPoller()"]) {
      assert.ok(at(src, effect) > lock, `${effect} يُنفَّذ قبل القفل في مُسجِّل Next`);
    }
    // الخاسرُ هنا لا يُقتَل: قتلُه يُسقط الموقعَ المحليَّ كلَّه بلا سبب
    assert.ok(/if \(!\(await startLocalSasServer\("yield"\)\)\) return/.test(src),
      "يجب أن يتنازل الخاسرُ عن الوظائف الخلفيّة **ويُكمل خدمةَ الصفحات**");
  });

  test("لا مِسبارَ يحجز المنفذَ ثمّ يُفلته — فتلك نافذةُ السباق", () => {
    const src = read("src/worker.ts"); // الملفُّ كلُّه هنا: المِسبارُ كان دالّةً معرَّفةً أعلاه
    assert.ok(!/probe/i.test(src), "عاد المِسبارُ: حجزٌ يُفَكّ فوراً = عاملان يمرّان معاً");
    assert.ok(!src.includes("node:net"), "العاملُ لا يحتاج `net` بعد أن صار الحجزُ هو القفل");
  });

  test("فشلُ الحجز لا يُبتلَع صامتاً", () => {
    const src = read("src/lib/localSasServer.ts");
    assert.ok(src.includes('if (e.code === "EADDRINUSE")'), "غابت معالجةُ المنفذِ المحجوز");
    assert.ok(/onBusy === "exit"[\s\S]{0,220}process\.exit\(0\)/.test(src),
      "الخاسرُ في وضع `exit` يجب أن يخرج — لا أن يُكمل عملَه بلا خادمه");
    assert.ok(src.includes("ready(false)"), "وفي وضع `yield` يجب أن يُعلِم مناديه أنّه لا يملك الحاسبة");
  });
});

describe("الفرضيّةُ التي يقوم عليها القفل", () => {
  test("النظامُ يرفض حجزَ المنفذ نفسِه مرّتَين (EADDRINUSE)", async () => {
    // القفلُ كلُّه يستند إلى هذا السلوك — فإن كذب على نظامٍ ما، سقط الحارسُ صامتاً.
    // نستخدم منفذاً يمنحه النظامُ (0) لا 47615، لئلّا نُزاحم عاملاً يعمل فعلاً.
    const first = net.createServer();
    await new Promise<void>((res) => first.listen(0, "127.0.0.1", () => res()));
    const port = (first.address() as net.AddressInfo).port;
    try {
      const code = await new Promise<string | undefined>((res) => {
        const second = net.createServer();
        second.once("error", (e: NodeJS.ErrnoException) => res(e.code));
        second.listen(port, "127.0.0.1", () => { second.close(() => res(undefined)); });
      });
      assert.equal(code, "EADDRINUSE", "نجح حجزٌ ثانٍ للمنفذ نفسِه ⇒ لا قفلَ على هذا النظام");
    } finally {
      await new Promise<void>((res) => first.close(() => res()));
    }
  });
});
