import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { planState, GRACE_DAYS, WARN_DAYS } from "../src/lib/agentPlan";

// ═════ ⛔ الوكيلُ المنتهي يتوقّف فعلاً — طلبُ محمد 2026-11-21 ═════
// كان `planExpiry` مفروضاً في مسار الدخول وحدَه، وكعكةُ الجلسة سنةٌ كاملة ⇒ مَن كان
// داخلاً يبقى بكامل صلاحيّاته سنةً بعد الانتهاء (وسيف ٣٨ عمل ٧٨ يوماً بعد انتهائه).
// نقطةُ الخنق: getSession/getTechSession في كلّ طلب. وهذه الحرّاسُ تحمي أن تبقى هناك.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("مراحلُ الاشتراك الأربع كما هي", () => {
  const at = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000);

  test("بلا تاريخِ انتهاءٍ = دائمٌ أبداً (وكيلُ شكيب نفسُه)", () => {
    const st = planState(null);
    assert.equal(st.status, "ok");
    assert.equal(st.daysLeft, Infinity);
  });

  test("التنبيهُ يبدأ قبل الانتهاء بسبعة أيّامٍ لا أكثر", () => {
    assert.equal(planState(at(WARN_DAYS + 2)).status, "ok");
    assert.equal(planState(at(WARN_DAYS - 1)).status, "warn");
  });

  test("مهلةُ السماح ثلاثةُ أيّامٍ ثمّ المنع", () => {
    assert.equal(planState(at(-1)).status, "grace");
    assert.equal(planState(at(-(GRACE_DAYS - 0.5))).status, "grace");
    assert.equal(planState(at(-(GRACE_DAYS + 0.5))).status, "blocked");
  });
});

describe("نقطةُ الخنق: الجلسةُ تُبطَل في كلّ طلب", () => {
  const auth = code("src/lib/auth.ts");
  const plan = code("src/lib/agentPlan.ts");

  test("جلسةُ المستخدم تفحص اشتراكَ وكيله قبل أن تُرجِع شيئاً", () => {
    const at = auth.indexOf("export async function getSession");
    assert.ok(at > -1, "🔴 getSession اختفت");
    const body = auth.slice(at);
    const chk = body.indexOf("isAgentBlocked(user.agentId)");
    const ret = body.indexOf("userId: user.id");
    assert.ok(chk > -1, "🔴 جلسةُ المستخدم لا تفحص اشتراكَ الوكيل — المنتهي يعمل سنةً كاملة");
    assert.ok(chk < ret, "🔴 الفحصُ بعد إرجاع الجلسة — لا يمنع شيئاً");
    assert.ok(/isAgentBlocked\(user\.agentId\)\)\s*return null/.test(auth), "🔴 الفحصُ لا يُبطل الجلسة");
  });

  test("جلسةُ الفنيّ تُبطَل هي أيضاً (قرارُ محمد: الفريقُ الداخليُّ كاملاً)", () => {
    const at = auth.indexOf("export async function getTechSession");
    assert.ok(at > -1, "🔴 getTechSession اختفت");
    const body = auth.slice(at, auth.indexOf("export async function getSession"));
    const chk = body.indexOf("isAgentBlocked(tech.agentId)");
    assert.ok(chk > -1, "🔴 فنيُّ الوكيل الممنوع يبقى يُنجز بطاقاتِه");
    assert.ok(chk < body.indexOf('kind: "technician", technicianId'), "🔴 الفحصُ بعد إرجاع جلسة الفنيّ");
  });

  test("مالكُ النظام (بلا وكيل) لا يُفحَص ولا يُستعلَم له", () => {
    assert.ok(/agentId == null\) return false/.test(plan),
      "🔴 بلا هذا الخروج المبكر: استعلامٌ لكلّ طلبٍ للمالك — أو إقفالُه على نفسه");
  });

  test("الممنوعُ يشمل سحبَ الموافقة والحذفَ الناعم", () => {
    assert.ok(/a\.isDeleted \|\| !a\.approved \|\| planState\(a\.planExpiry\)\.status === "blocked"/.test(plan),
      "🔴 سحبُ موافقتك عن وكيلٍ قائمٍ لا يوقفه — الثغرةُ عينُها");
  });

  test("عطلُ القاعدة لا يُقفل وكيلاً يعمل، ولا يُخزَّن في الكاش", () => {
    const fn = plan.slice(plan.indexOf("export async function isAgentBlocked"));
    const cat = fn.indexOf("catch");
    const set = fn.indexOf("blockCache.set");
    assert.ok(cat > -1 && cat < set, "🔴 لا التقاطَ لعطل القاعدة قبل التخزين");
    assert.ok(/catch[\s\S]{0,320}return false;\s*\}/.test(fn),
      "🔴 عطلُ قاعدةٍ عارضٌ يُقفل الوكلاءَ جميعاً — أو يُخزَّن القفلُ دقيقةً");
  });

  test("الكاشُ يُبطَل لحظةَ تجديد المالك فلا تنتظر دقيقة", () => {
    const owner = code("src/app/api/owner/agents/[id]/route.ts");
    assert.ok(/clearAgentBlockCache\(agentId\)/.test(owner), "🔴 التجديدُ لا يُبطل الكاش");
    assert.ok(owner.indexOf("prisma.agent.update") < owner.indexOf("clearAgentBlockCache(agentId)"),
      "🔴 الإبطالُ قبل الحفظ — يُعيد الكاشُ القديمَ نفسَه");
  });

  test("مسارُ الدخول يبقى يقول للوكيل سببَه (لا ٤٠١ صامتة)", () => {
    const login = code("src/app/api/auth/login/route.ts");
    assert.ok(/st\.status === "blocked"\) return st\.message/.test(login),
      "🔴 ضاعت رسالةُ «انتهت فترة اشتراكك» من صفحة الدخول");
  });
});
