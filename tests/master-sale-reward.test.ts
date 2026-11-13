import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🅜🎁 كودُ المكافأة في بيع الماستر (قرارُ محمد 2026-11-13) ═════
// كان الماسترُ **بلا مشترك** أصلاً (الخادمُ لا يحمّله والواجهةُ تخفي المنتقي) فلا كودَ له.
// والآن: المشترِكُ اختياريٌّ في الماستر فيُخصَم كودُه، ويبقى الماسترُ بلا دَينٍ ومالُه
// لمكتب البائع لا لمكتب المشترك.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const API = "src/app/api/invoices/route.ts";
const PAGE = "src/app/(app)/invoices/page.tsx";

describe("🅜 الخادم: المشترِكُ اختياريٌّ في الماستر", () => {
  test("يُحمَّل المشتركُ متى أُرسل معرّفُه، ويبقى إلزاميّاً في البيع العاديّ", () => {
    const c = code(API);
    assert.ok(/if \(!direct && \(subscriberId \|\| !master\)\)/.test(c), "الماسترُ ما زال يُسقط المشترك ⇒ لا كودَ معه");
    assert.ok(/if \(!subscriberId\) return NextResponse\.json\(\{ error: "اختر المشترك/.test(c), "سقط إلزامُ المشترك في البيع العاديّ");
  });
  test("والعزلُ باقٍ: مشترِكُ مكاتب وكيله وحدَه", () => {
    const c = code(API);
    assert.ok(/sameAgentTower\(g\.session, subscriber\.towerId\)/.test(c), "سقط فحصُ تبعيّة المشترك للوكيل");
  });
  test("مالُ الماستر يبقى لمكتب البائع لا يهاجر لمكتب المشترك", () => {
    const c = code(API);
    assert.ok(/const towerId = \(master \? g\.session\.towerId : subscriber\?\.towerId\) \?\? g\.session\.towerId/.test(c),
      "مكتبُ فاتورة الماستر صار يتبع المشترك ⇒ مالٌ يهاجر بين المكاتب بلا قرار");
  });
  test("والماسترُ بلا دَينٍ أيّاً كان، وواصلٌ بالكامل", () => {
    const c = code(API);
    assert.ok(/const remainder = master \? 0 :/.test(c), "ظهر دَينٌ في بيع الماستر");
    assert.ok(/waselHim: master \? netTotal :/.test(c), "الواصلُ في الماستر ليس كاملَ المستحقّ");
  });
  test("وأهليّةُ الخصم لم تُفتَح للبيع المباشر", () => {
    const c = code(API);
    assert.ok(/if \(!direct && subscriber && useReward/.test(c), "شرطُ أهليّة المكافأة تغيّر");
  });
});

describe("🖥️ الواجهة: المنتقي والكودُ يظهران في الماستر", () => {
  test("لا شرطَ masterMode على الخصم ولا على إرسال المشترك والكود", () => {
    const c = code(PAGE);
    assert.ok(/const discount = !direct && rewardPulled/.test(c), "الخصمُ ما زال مُلغىً في وضع الماستر");
    assert.ok(/subscriberId: direct \? null : sub\?\.id \?\? null/.test(c), "الماسترُ ما زال يرسل مشترِكاً فارغاً");
    assert.ok(/useReward: !direct && rewardPulled/.test(c), "الماسترُ ما زال يرسل useReward=false");
    assert.ok(/\{!direct && \(<>/.test(c), "منتقي المشترك ما زال مخفيّاً في الماستر");
  });
  test("والمشترِكُ إلزاميٌّ في البيع العاديّ وحدَه", () => {
    const c = code(PAGE);
    assert.ok(/if \(!direct && !masterMode && !sub\)/.test(c), "صار الماسترُ يُلزم باختيار مشترك");
  });
});
