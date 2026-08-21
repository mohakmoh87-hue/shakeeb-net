import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sasWindowBound } from "@/lib/sas4";

// ═════ 🎴 الطبقةُ الثانية: صفحةُ التفعيلات المرتَّبة وقواعدُ الكروت (إملاءُ محمد 2026-08-22) ═════
//
// نصُّه: «في كلّ مزامنةٍ ولكلّ مكتبٍ على حِدة: ادخل تقريرَ التفعيلات، كبّر الـ٥٠٠، وسفّط
// من التاريخ الأحدث، وخذ الصفحةَ كاملةً — ثمّ اعمل بلا حاجةٍ للساس».
// وقواعدُه الثلاث: ٥· الكارتُ يُعلَّم مستخدماً إن كان لصاحبه **تفعيلٌ ووصلٌ في ±٣ أيّام**
// · ٦· وبلا وصلٍ فهو **مسروقٌ من المخزن** · ٩· والمكرَّرُ يُقاس **بالمال** لا بعدد الكروت.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const SAS = () => read("src/lib/sas4.ts");
const SYNC = () => read("src/lib/subscriptionSync.ts");
const LOG = () => read("src/lib/syncLog.ts");

describe("🗓️ الجالبُ مرتَّبٌ بالتاريخ لا مُجمَّعاً بالمنجر", () => {
  test("الصيغةُ التي نجحت وحدَها من عشرٍ: sortBy=created_at", () => {
    const s = SAS();
    assert.ok(s.includes('const SORT_BODY = { sortBy: "created_at", sortDir: "desc" }'), "صيغةُ الترتيب غائبة");
    assert.ok(s.includes("fetchSortedActivations"), "الجالبُ المرتَّب غير موجود");
  });

  test("🛡️ حارسُ الصدق: ترتيبٌ لم يُطبَّق ⇒ سقوطٌ للقديم لا ادّعاءُ اكتمال", () => {
    const s = SAS();
    assert.ok(s.includes("function isDescending("), "لا فحصَ لاتّجاه الصفوف");
    assert.ok(s.includes("return { rows: [], complete: false, sorted: false }"), "لا يُعلَن سقوطُ الترتيب");
    assert.ok(s.includes("legacyFetchActivationsForDay"), "لا مسارَ احتياطيَّ ليوم المزامنة");
    assert.ok(s.includes("legacyFetchActivationsSince"), "لا مسارَ احتياطيَّ للجرد");
  });

  test("المزامنةُ اليوميّةُ والجردُ كلاهما يمرّان بالمرتَّب", () => {
    const s = SAS();
    const day = s.slice(s.indexOf("export async function sasFetchActivationsForDay"));
    assert.ok(day.slice(0, 900).includes("fetchSortedActivations"), "المزامنةُ اليوميّةُ لم تنتقل");
    const since = s.slice(s.indexOf("export async function sasFetchActivationsSince"));
    assert.ok(since.slice(0, 700).includes("fetchSortedActivations"), "الجردُ لم ينتقل");
  });
});

describe("⏱️ نافذةٌ بلا إزاحةِ الثلاث ساعات", () => {
  test("الحدُّ يُزاح ٣ ساعاتٍ ليطابق أرقامَ الساس", () => {
    const d = new Date("2026-08-21T21:00:00.000Z");
    assert.equal(sasWindowBound(d).toISOString(), "2026-08-22T00:00:00.000Z");
  });

  test("🔴 الحالةُ التي كانت تسقط: تفعيلُ ٢٢:٤١ بغداد داخلَ نافذة اليوم", () => {
    // نهايةُ «اليوم» بتوقيت بغداد كلحظةٍ حقيقيّة = 20:59:59Z، وأرقامُ الساس 22:41 ⇒ كان يسقط
    const dayEnd = new Date("2026-08-21T20:59:59.999Z");
    const sasRow = new Date("2026-08-21T22:41:39.000Z"); // أرقامُ الساس تُقرأ UTC
    assert.ok(sasRow > dayEnd, "المقدّمةُ خاطئة");
    assert.ok(sasRow <= sasWindowBound(dayEnd), "ما زال يسقط من النافذة");
  });

  test("والمزامنةُ ترشّح تفعيلاتِ أمسٍ بالحدود المُزاحة", () => {
    assert.ok(SYNC().includes("const actsLo = sasWindowBound(start), actsHi = sasWindowBound(end);"), "الترشيحُ لم يُصحَّح");
  });
});

describe("🎴 قاعدةُ ٥ و٦: الكارتُ يُقاس بالوصل", () => {
  test("النافذةُ ±٣ أيّامٍ ومهلةُ الورق ٢٤ ساعة", () => {
    const s = SYNC();
    assert.ok(s.includes("const CARD_RECEIPT_MS = 3 * 86400_000;"), "نافذةُ الوصل ليست ٣ أيّام");
    assert.ok(s.includes("const STOLEN_GRACE_MS = 24 * 3600_000;"), "مهلةُ الورق غائبة");
  });

  test("حكمٌ واحدٌ للكارت في موضعٍ واحد (لا فرعان متباعدان)", () => {
    const s = SYNC();
    assert.ok(s.includes("const handleStockCard = async ("), "دالّةُ الحكم غائبة");
    assert.ok(s.includes("await handleStockCard(card, a, pin, sub,"), "فرعُ المشترك المعروف لم يمرّ بها");
    assert.ok(s.includes("await handleStockCard(card, a, pin, null,"), "فرعُ اليوزر غير المستورد لم يمرّ بها");
  });

  test("🔒 الكارتُ **المبيع** لا يُتَّهم — مسارُ البيع يُعلّمه باسم بائعه بلا وصل", () => {
    const s = SYNC();
    assert.ok(s.includes("const consumedByHuman ="), "لا تمييزَ لمن استهلكه إنسان");
    assert.ok(s.includes('!== "sync"'), "لا يُفرَّق بين تعليم المزامنة وتعليم الإنسان");
    assert.ok(s.includes("if (wasHuman) return;"), "المبيعُ ما زال يمرّ إلى حكم السرقة");
    // والمسارُ الذي يوجب هذا الحرس ما زال كما هو (تحقّقٌ من الواقع لا من الذاكرة)
    const sell = read("src/app/api/recharge-cards/[id]/sell/route.ts");
    assert.ok(sell.includes("useDate: new Date(), userName:"), "تغيّر مسارُ البيع — يجب مراجعةُ الحرس");
  });

  test("بلا وصلٍ ⇒ حالةُ سرقةٍ تُسجَّل، ويُعلَّم الكارتُ مستخدماً على كلّ حال", () => {
    const s = SYNC();
    assert.ok(s.includes("await recordStolenCardCase({"), "لا تُسجَّل حالةُ السرقة");
    assert.ok(s.includes("if (await receiptNearCard(uKey, sub?.id ?? null, when)) return;"), "لا يُسأل عن الوصل");
    assert.ok(s.includes("markedUsed++;"), "لم يعد يُعلَّم مستخدماً");
  });

  test("♻️ وتُغلق نفسَها متى ظهر الوصل", () => {
    assert.ok(LOG().includes("export async function reconcileStolenCards("), "لا إغلاقَ ذاتيّ");
    assert.ok(SYNC().includes("await reconcileStolenCards(officeId,"), "الإغلاقُ الذاتيُّ غيرُ موصول");
  });

  test("💰 ولا يتحرّك مالٌ في مسار السرقة (بلاغٌ لا قيد)", () => {
    const fn = SYNC().slice(SYNC().indexOf("const handleStockCard = async ("));
    const body = fn.slice(0, fn.indexOf("\n  };"));
    assert.ok(!body.includes("subscriptionEntry.create"), "أُنشئ وصلٌ في مسار السرقة");
    assert.ok(!body.includes("carry"), "مُسَّ دينُ مشترك في مسار السرقة");
  });

  test("والجردُ الليليُّ على القاعدة نفسِها (وإلّا أطفأ الإنذارَ بصمت)", () => {
    const s = SYNC();
    assert.ok(s.includes("const auditJudge = async ("), "الجردُ بلا حكم");
    assert.ok(s.includes("await auditJudge(hit, serial, sub,"), "موضعُ التعليم الأوّل بلا حكم");
    assert.ok(s.includes("await auditJudge(found, serial, owner,"), "موضعُ التعليم الثاني بلا حكم");
  });
});

describe("💵 قاعدةُ ٩: المكرَّرُ يُقاس بالمال", () => {
  test("وصلٌ واحدٌ بمجموع التفعيلتَين ⇒ طبيعيّ", () => {
    const s = SYNC();
    assert.ok(s.includes("if (paid >= totalActs) continue;"), "لا مقارنةَ بالمال");
    assert.ok(!s.includes("if (programUsed <= 1) {"), "ما زال يعدّ الكروت لا المال");
  });

  test("والفارقُ يُذكَر بالمبلغ والسيريالات (إنذارٌ واحدٌ لا اتّهامُ كارتٍ بعينه)", () => {
    const s = SYNC();
    assert.ok(s.includes("**الفارق ${totalActs - paid}**"), "الفارقُ غيرُ معروض");
    assert.ok(s.includes("receiptsSumNear"), "لا مجموعَ للوصولات");
  });

  test("💵 والمقارنةُ بقيمة الاشتراك لا بالواصل (فمن عليه دَينٌ وصلُه موجود)", () => {
    assert.ok(SYNC().includes("select: { date: true, dateTo: true, money: true },"), "قيمةُ الوصل غيرُ مجلوبة");
  });
});

describe("🎯 المسبارُ من الصفحة لا من الساس", () => {
  test("فهرسُ تفعيلات النافذة باليوزر يُبنى مرّةً", () => {
    const s = SYNC();
    assert.ok(s.includes("const actsByUserAll = new Map<string, SasActivation[]>();"), "لا فهرسَ في الذاكرة");
    assert.ok(s.includes("let rows = actsByUserAll.get(uKey) ?? [];"), "التصنيفُ لا يقرأ الفهرس");
  });

  test("والسقفُ يعدّ النداءَ الشبكيَّ وحدَه ويُعلَن في التقرير", () => {
    const s = SYNC();
    assert.ok(!s.includes("if (!classified && dateProbes < MAX_DATE_PROBES) {"), "السقفُ ما زال يمنع التصنيفَ المجّانيّ");
    assert.ok(s.includes("probesCapped++"), "لا عدّادَ لما سقط بالسقف");
    assert.ok(s.includes("قفزاتُ تاريخٍ لم تُصنَّف"), "السقفُ ما زال صامتاً في التقرير");
  });

  test("🔴 حارسُ الازدواج مُقيَّدٌ بالواقعة نفسِها لا بأيّ صفٍّ قديم", () => {
    const s = SYNC();
    assert.ok(s.includes("{ sasDateTo: { gte: expLo, lte: expHi } },"), "الحارسُ ما زال بلا حدّ");
    assert.ok(!s.includes('where: { towerId: officeId, sasId: u.sasId, kind: { in: ["sas", "self", "install"] }, activatedAt: { not: null } },'),
      "الاستعلامُ القديمُ بلا حدٍّ ما زال قائماً");
  });
});

describe("🕵️ حارسُ المال يعرض الحكمَ الجديد", () => {
  test("عنوانٌ وخطورةٌ مستقلّان لـ«مسروق»", () => {
    const m = read("src/lib/moneyHealth.ts");
    assert.ok(m.includes('verdict === "stolen"'), "الحكمُ غيرُ معروف في حارس المال");
    assert.ok(m.includes("يُشتبه بسرقة"), "لا عنوانَ للحالة");
    assert.ok(m.includes('severity: verdict === "stolen" || verdict === "no-receipt" ? "critical" : "info"'), "الخطورةُ ليست حمراء");
  });

  test("والنوعُ ما زال خارجَ نافذة سجلّ المزامنة (تبويباتُها أربعةٌ ثابتة)", () => {
    const api = read("src/app/api/sync-log/route.ts");
    assert.ok(api.includes('kind: { in: ["info", "install", "self", "sas"] }'), "تسرّب نوعُ الكروت إلى النافذة");
  });
});
