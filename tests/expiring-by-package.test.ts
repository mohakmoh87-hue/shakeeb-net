import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 📦 «تذكير قبل الانتهاء حسب الباقة» — إملاءُ محمد 2026-08-21 ═════
// «قالبٌ لكلّ باقةٍ موجودة، وأيُّ باقةٍ تُضاف مستقبلاً يصير لها قالبٌ فيه. ويُرسَل قبل
//  الانتهاء **حسب باقة المشترك**، ومن ليس لديه باقةٌ لا يصله شيء. وتفعيلُ أحد القالبَين
//  يُلغي تفعيلَ الآخرِ تلقائيّاً — لا يجتمعان أبداً. ومن يُفعّل القديمَ لا يتغيّر لديه شيء.»

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SCHED = () => read("src/lib/scheduler.ts");
const BYPKG = () => read("src/app/api/sms-templates/by-package/route.ts");

describe("📦 تذكيرُ الانتهاء حسب الباقة", () => {
  test("١ · القائمةُ تُبنى من جدول الباقات — فالباقةُ الجديدةُ تظهر تلقائيّاً", () => {
    const r = BYPKG();
    assert.ok(r.includes("prisma.package.findMany("), "القائمةُ ليست من جدول الباقات");
    assert.ok(r.includes("agentId: agentId ?? -1, isDeleted: false"), "عزلُ الوكيل غائبٌ عن قائمة الباقات");
    assert.ok(read("src/lib/smsTemplates.ts").includes("export const expiringPkgType = (packageId: number)"), "لا نوعَ قالبٍ لكلّ باقة");
  });

  test("٢ · **من لا باقةَ له لا يصله تذكيرٌ إطلاقاً** — ولا رجوعَ للقالب العامّ", () => {
    const s = SCHED();
    assert.ok(s.includes("if (packageId == null) return null; // بلا باقةٍ ⇒ بلا تذكيرِ انتهاءٍ (نصُّ محمد)"), "من لا باقةَ له قد يصله تذكير");
    assert.ok(s.includes("await getTemplate(expiringPkgType(packageId), agentId, towerId)"), "لا يُقرأ قالبُ باقة المشترك");
    // باقةٌ بلا نصّ ⇒ `getTemplate` تعود null ⇒ `continue` القائمُ أصلاً يمنع الإرسال
    assert.ok(s.includes("if (!template) continue;"), "قالبٌ فارغٌ قد يُرسَل");
  });

  test("٣ · القالبُ القديمُ كما هو لمن لم يُفعّل الوضعَ الجديد", () => {
    const s = SCHED();
    assert.ok(s.includes('if (!tplCache.has(key)) tplCache.set(key, await getTemplate("expiring", agentId, towerId));'), "المسارُ القديمُ تغيّر");
    assert.ok(s.includes("if (await byPkgMode(agentId, towerId)) {"), "لا تفريعَ على الوضع");
  });

  test("٤ · 🔒 القفلُ المتبادل محروسٌ على **الخادم** من الجهتَين", () => {
    // تفعيلُ الجديد يُطفئ القديم
    assert.ok(BYPKG().includes('await setRow("expiring", on ? "0" : "1");'), "تفعيلُ الجديد لا يُطفئ القديم");
    // وتفعيلُ القديم يُطفئ الجديد
    const bulk = read("src/app/api/sms-templates/bulk/route.ts");
    assert.ok(bulk.includes('const expTouched = parsed.data.templates.find((t) => t.type === "expiring" && !t.reset);'), "حفظُ القالب القديم بلا قفل");
    assert.ok(bulk.includes('data: { enable: "0" }'), "تفعيلُ القديم لا يُطفئ وضعَ الباقات");
  });

  test("٥ · عزلُ الوكيل والمكتب: لا يُكتَب قالبٌ لباقةِ وكيلٍ آخر", () => {
    const r = BYPKG();
    assert.ok(r.includes("prisma.package.findFirst({ where: { id: t.packageId, agentId: agentId ?? -1 }"), "لا تحقّقَ من ملكيّة الباقة");
    assert.ok(r.includes("if (!session.isAdmin && session.towerId != null) return session.towerId;"), "مستخدمُ المكتب غيرُ مقيَّدٍ بمكتبه");
  });

  test("٦ · الصورةُ وسقفُها كبقيّة القوالب", () => {
    const r = BYPKG();
    assert.ok(r.includes("const IMAGE_MAX_CHARS = 400_000;"), "لا سقفَ لحجم الصورة");
    assert.ok(r.includes("t.image === undefined ? {} : { image: t.image?.trim() || null }"), "غيابُ الحقل لا يعني «لا تمسّها»");
  });
});
