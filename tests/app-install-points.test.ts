import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cardMatchesSubscriber, APP_INSTALL_WINDOW_MS } from "../src/lib/appInstall";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const LIB = "src/lib/appInstall.ts";
const LOGIN = "src/lib/subscriberLogin.ts";
const COMPLETE = "src/app/api/field/complete/route.ts";
const ACH = "src/lib/achievements.ts";
const TYPES = "src/app/api/field/card-types/route.ts";

// ═══════ 📲 نقاطُ تنصيب التطبيق — قواعدُ محمد الأربعُ وقراراه (2026-10-27) ═══════
describe("📲 نقاطُ تنصيب التطبيق للفنيّ", () => {
  test("النافذةُ أربعٌ وعشرون ساعةً بالضبط، ومن الجهتَين", () => {
    assert.equal(APP_INSTALL_WINDOW_MS, 24 * 60 * 60 * 1000);
    const src = read(LIB);
    // قاعدةُ محمد ٤: «منصِّبٌ قبل الإنجاز بـ٢٤ ساعةً أو أكثر ⇒ لا نقاط» ⇒ حدٌّ سفليّ.
    // وقراره عند السؤال: نافذةٌ من الجهتَين كي لا يضيع حقُّ من نصّب ثمّ أغلق البطاقة.
    assert.ok(src.includes("first.getTime() - APP_INSTALL_WINDOW_MS"), "الحدُّ السفليُّ (قبل الدخول)");
    assert.ok(src.includes("first.getTime() + APP_INSTALL_WINDOW_MS"), "والحدُّ العلويُّ (بعده)");
  });

  test("🔑 تُشترط بطاقةٌ **قائمةٌ قبل** الدخول — فمن نصّب بنفسه لا يُهدي نقاطاً", () => {
    const src = read(LIB);
    // قاعدةُ محمد ٣ وقراره: `createdAt <= firstLoginAt` هو تجسيدُها.
    assert.ok(/createdAt: \{ lte: first \}/.test(src), "البطاقةُ أُنشئت قبل أوّلِ دخولٍ له");
  });

  test("الجائزةُ مرّةٌ واحدةٌ لكلّ مشترك — والنداءُ مرّتَين لا يمنح مرّتَين", () => {
    const src = read(LIB);
    // 🔴 درسُ حارس التنفيذ المزدوج: النداءُ من مكانَين (الإنجاز والدخول) فقد يتزامنان.
    assert.ok(src.includes("where: { subscriberId, awarded: false }"), "الشرطُ في الـwhere لا في if قبلها");
    const schema = read("prisma/schema.prisma");
    assert.ok(/subscriberId Int\s+@unique/.test(schema), "صفٌّ واحدٌ لكلّ مشترك في جدول المنصِّبين");
  });

  test("المنصِّبُ قبل الميزة يُختَم legacy: شريطٌ سماويٌّ بلا جائزةٍ أبداً", () => {
    const src = read(LIB);
    assert.ok(src.includes("ON CONFLICT (\"subscriberId\") DO NOTHING"), "الختمُ الأوّليُّ يُعاد تنفيذُه بلا أثر");
    assert.ok(/legacy[\s\S]{0,40}true/.test(src), "ويُسجَّل legacy");
    assert.ok(/if \(!row \|\| row\.legacy \|\| row\.awarded/.test(src), "و legacy يُرفَض في المنح");
  });

  test("⚠️ `recordAppInstall` يسبق طابعَ `lastAppLoginAt` — وإلّا صار المنصِّبُ الجديدُ legacy", () => {
    const src = read(LOGIN);
    const rec = src.indexOf("recordAppInstall(subscriberId)");
    const stamp = src.indexOf("lastAppLoginAt: new Date()");
    assert.ok(rec > 0 && stamp > 0, "النداءان موجودان");
    assert.ok(rec < stamp, "الترتيبُ معكوسٌ ⇒ الختمُ الأوّليُّ سيبتلع كلَّ منصِّبٍ جديد");
  });

  test("🔒 العزلُ بالمعرّفات: البطاقاتُ المرشَّحةُ لفنيّي ذلك الوكيل وحدَهم", () => {
    const src = read(LIB);
    assert.ok(src.includes('prisma.technician.findMany({ where: { agentId: row.agentId }'), "فنيّو الوكيل من القاعدة");
    assert.ok(src.includes("technicianId: { in: techs.map((t) => t.id) }"), "والبطاقاتُ مقصورةٌ عليهم");
    assert.ok(src.includes("row.agentId == null) return"), "وبلا وكيلٍ لا منحَ إطلاقاً");
  });

  test("أفضلُ جهدٍ: لا يُفشل الإنجازَ ولا الدخول", () => {
    assert.ok(/maybeAwardAppInstall\(appSubId\);[\s\S]{0,80}catch \{ \/\* لا يُفشل الإنجاز/.test(read(COMPLETE)), "الإنجازُ محميّ");
    assert.ok(/recordAppInstall[\s\S]{0,160}catch \{ \/\* لا يُفشل الدخول/.test(read(LOGIN)), "والدخولُ محميّ");
  });

  test("المنحُ بعد أن تصير البطاقةُ منجزةً — وإلّا لم يرَها الاستعلام", () => {
    const src = read(COMPLETE);
    const done = src.indexOf("done: true, completedAt: new Date(), durationSec");
    const award = src.indexOf("maybeAwardAppInstall");
    assert.ok(done > 0 && award > done, "نداءُ الجائزة بعد تحديث البطاقة");
    // ويُقبَل المشتركُ بمعرّف البطاقة أو بمطابقة الإنجاز — لا بشيءٍ من الطلب
    assert.ok(src.includes("card.subscriberId ?? matchedSub?.id ?? null"), "المشتركُ من البطاقة أو من المطابقة");
  });

  test("النقاطُ تُجمَع في الإنجازات ولا تُعدّ بطاقةً", () => {
    const src = read(ACH);
    assert.ok(src.includes("appInstallBonuses(agentId"), "الجوائزُ تُحمَّل مع البيانات");
    assert.ok(src.includes("a.points += b.points;"), "تُضاف إلى النقاط");
    assert.ok(!/a\.cards \+= b\.count/.test(src), "ولا تُعدّ بطاقةً");
    assert.ok(src.includes("!comps.length && bonuses.size === 0"), "وفنيٌّ بجائزةٍ بلا بطاقةٍ لا يسقط من الجدول");
    // لقطةُ المقدار محفوظةٌ لحظةَ المنح ⇒ تغييرُ الإعداد لا يُعيد حسابَ الماضي
    assert.ok(read(LIB).includes("points }"), "المقدارُ يُحفَظ في الصفّ");
  });

  test("المقدارُ بيد المدير لكلّ وكيلٍ — وصفرٌ قيمةٌ صريحة", () => {
    const src = read(TYPES);
    assert.ok(src.includes('b.id == null && "appInstallPoints" in b'), "إعدادُ وكيلٍ لا فئةٍ (بلا id)");
    assert.ok(src.includes("g.session?.agentId ?? null"), "والوكيلُ من الجلسة لا من الطلب");
    assert.ok(read(LIB).includes("row?.appInstallPoints ?? 0"), "والافتراضيُّ صفرٌ = بلا نقاط");
  });

  test("🖥️ حاسبةُ المكتب: لا DDL لها ⇒ الإنشاءُ يُبتلَع والقراءةُ تتحمّل", () => {
    const src = read(LIB);
    // 🔴 حاسبةُ المكتب تُشغّل **نفسَ الموقع** بدور `agent_N_worker` بلا صلاحيّةِ إنشاء.
    //    فلو رُمي الخطأُ لانكسرت صفحاتٌ قائمةٌ (أنواعُ البطاقات · الإنجازات · المشتركون).
    assert.ok(/if \(ready \|\| tried\) return;/.test(src), "محاولةٌ واحدةٌ لا حلقةُ فشلٍ في كلّ نداء");
    assert.ok(/catch \{ \/\* حاسبةُ مكتبٍ بلا DDL/.test(src), "وفشلُ الإنشاء يُبتلَع");
    assert.ok(src.includes("catch { return 0; }"), "ومقدارُ النقاط يتحمّل");
    assert.ok(src.includes("catch { return new Set(); }"), "والشريطُ السماويُّ يتحمّل");
    assert.ok(src.includes(".catch(() => [] as { technicianId"), "ولوحةُ الإنجازات تتحمّل");
    // «كتابةٌ/قراءةٌ جديدة = GRANT»: وإلّا سقطت الجائزةُ صامتةً لكلّ بطاقةٍ تُنجَز من مكتب
    const gr = read("prisma/rls/02-grants.sql");
    assert.ok(/GRANT SELECT, UPDATE ON subscriber_app_installs TO agent_worker;/.test(gr), "إذنُ الجائزة للعامل");
    assert.ok(gr.includes("agent_points_settings_id_seq"), "وتسلسلُ إعداد النقاط");
    const pol = read("prisma/rls/03-policies.sql");
    for (const t of ["subscriber_app_installs", "agent_points_settings"]) {
      assert.ok(pol.includes(`rls_${t}`), `لا سياسةَ عزلٍ لـ${t}`);
    }
  });

  test("🔓 كلُّ بطاقةٍ تصلح — لا نوعٌ بعينه («أي بطاقة كانت»)", () => {
    const src = read(LIB);
    const q = src.slice(src.indexOf("prisma.taskCard.findMany"), src.indexOf("orderBy: { completedAt"));
    assert.ok(!/kind:/.test(q), "لا ترشيحَ بنوع البطاقة");
    assert.ok(q.includes("done: true"), "لكنّها منجزةٌ قطعاً");
    assert.ok(q.includes("isDeleted: false"), "وغيرُ ملغاةٍ/محذوفة");
  });
});

describe("📲 مطابقةُ البطاقة بالمشترك", () => {
  const card = (o: Partial<{ subscriberId: number | null; title: string; description: string | null }>) => ({
    id: 1, technicianId: 5, createdAt: new Date(),
    subscriberId: o.subscriberId ?? null, title: o.title ?? "بطاقة", description: o.description ?? null,
  });

  test("المعرّفُ أقوى من النصّ: بطاقةُ مشتركٍ آخرَ تُرفَض ولا يُجرَّب نصُّها", () => {
    const c = card({ subscriberId: 99, description: "اليوزر: bg-1-2-3@kab" });
    assert.equal(cardMatchesSubscriber(c, 7, "bg-1-2-3@kab"), false);
    assert.equal(cardMatchesSubscriber(c, 99, null), true);
  });

  test("بلا معرّفٍ: يوزرُه كلمةً كاملةً في نصّ البطاقة", () => {
    assert.equal(cardMatchesSubscriber(card({ description: "اليوزر: bg-1-2-3@kab\nصيانة" }), 7, "bg-1-2-3@kab"), true);
    assert.equal(cardMatchesSubscriber(card({ title: "صيانة bg-1-2-3@kab" }), 7, "BG-1-2-3@KAB"), true, "بلا حسّاسيةِ حالة");
    // ولا مطابقةَ جزئيّة: «bg-1-2-3@kab2» مشتركٌ آخر
    assert.equal(cardMatchesSubscriber(card({ description: "bg-1-2-3@kab2" }), 7, "bg-1-2-3@kab"), false);
    assert.equal(cardMatchesSubscriber(card({ description: "لا شيء" }), 7, "bg-1-2-3@kab"), false);
  });

  test("يوزرٌ فارغٌ أو قصيرٌ لا يطابق شيئاً — وإلّا نالت كلُّ بطاقةٍ جائزة", () => {
    assert.equal(cardMatchesSubscriber(card({ description: "اليوزر: —" }), 7, ""), false);
    assert.equal(cardMatchesSubscriber(card({ description: "ab" }), 7, "ab"), false);
  });
});
