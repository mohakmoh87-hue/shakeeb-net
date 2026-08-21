import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🕵️ الفحصُ الجذريُّ 2026-08-21 (طلبُ محمد: «افحص كلَّ الاحتمالات ولا تتوقّف عند أوّل خطأ») ═════
// سبعةُ أعطالٍ **مقيسةٍ على بياناته الحيّة وعلى مخدّم الساس نفسِه**، وهذه حراسُها:
//   ١ قواعدُ المال تُقاس على صفّ المشترك لا على اليوزر (حالة bg-13-6-3@mu: صفّان، الوصلُ في أحدهما).
//   ٢ بحثُ الساس (`search`) **مُتجاهَلٌ تماماً** — اختُبرت ١٢ صيغة، كلُّها تعيد أقدمَ ١٠ صفوفٍ من ٣٧٢٢١.
//   ٣ بصمتان مختلفتان للتجاهل ⇒ كلُّ متجاهَلٍ يعود في أوّل مزامنة.
//   ٤ الساس ينهي 17:00Z والبرنامج 00:00Z ⇒ فرقُ يومٍ كاذب (١٤ من ٣٣ صفَّ تاريخٍ قِيست ٧ ساعاتٍ بالضبط).
//   ٥ «تحديث» يكتب حقولاً لم تُرصَد ⇒ يمحو ملاحظاتِ محمد في الأسماء.
//   ٦ الاستبدالُ يقع لمجرّد اختلاف رقم الساس ⇒ يُنشئ مكرَّراً جديداً بيد المستخدم.
//   ٧ صفوفُ تفعيلِ الشركة المؤرَّخةُ تحجب صفَّ الحالة (take:5 على نفس الـkind).

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SYNC = () => read("src/lib/subscriptionSync.ts");
const API = () => read("src/app/api/sync-log/route.ts");
const LOG = () => read("src/lib/syncLog.ts");
const SAS = () => read("src/lib/sas4.ts");

describe("🕵️ الأعطالُ الجذريّةُ السبعة", () => {
  test("١ · «مقبوضٌ عندي» تُقاس على اليوزر — كلُّ صفوفه لا الصفُّ المرصود وحدَه", () => {
    const src = SYNC();
    assert.ok(src.includes("const idsByUser = new Map<string, number[]>();"), "لا فهرسَ ليوزرٍ متعدّدِ الصفوف");
    assert.ok(src.includes("const collectedByUs = async ("), "لا دالّةَ موحّدةً لقاعدة «مقبوضٌ عندي»");
    assert.ok(src.includes("subscriberId: { in: ids }"), "الوصولاتُ ما زالت تُجلَب لصفٍّ واحد");
    // ولا يبقى فحصُ وصلٍ قديمٌ بصفٍّ مفردٍ في مسارَي الحدث والتاريخ
    assert.equal(/subscriberId: sub\.id, isDeleted: false,\s*\n\s*date: \{ gte: new Date\(actAt/.test(src), false,
      "ما زال فحصُ الوصل يسأل عن صفٍّ واحدٍ بنافذة ±١٢ ساعة");
    assert.ok(src.includes("if (await collectedByUs(subUserKey, sub.id, actAt, validNewExp))"), "حلقةُ الأحداث لا تستعمل القاعدة الجديدة");
  });

  test("٢ · لا اعتمادَ على «بحث» الساس — نافذةٌ مفهرَسةٌ تُجيب كلَّ الأسئلة", () => {
    const sas = SAS();
    assert.ok(sas.includes("export async function sasActivationWindow("), "لا نافذةَ تفعيلاتٍ مفهرَسة");
    assert.ok(sas.includes("export function actWindowFindSerial("), "لا بحثَ سيريالٍ من الفهرس");
    assert.ok(sas.includes("export async function sasFindSerial("), "لا بديلَ لبحث السيريال");
    // والنافذةُ معزولةٌ بالتوكن لا بالرابط (حسابان على مخدّمٍ واحدٍ لا يريان بعضهما)
    assert.ok(sas.includes("const key = `${base}|${String(token).slice(-24)}|${days}`;"), "ذاكرةُ النافذة غيرُ معزولةٍ بالحساب");
    // ولا يبقى مستدعٍ واحدٌ للبحث المعطَّل في مسارات الكروت
    for (const f of ["src/lib/subscriptionSync.ts", "src/lib/cardSasCheck.ts", "src/lib/cardDeleteGuard.ts"]) {
      assert.equal(/await sasSearchActivation\(|await sasProbeSerial\(/.test(read(f)), false, `${f} ما زال يستعمل بحثَ الساس المعطَّل`);
    }
    // ونافذةٌ ناقصةٌ لا تُقرأ «غيرَ مستخدَم» أبداً
    assert.ok(read("src/lib/cardSasCheck.ts").includes("verdict = !hit && !probedOk"), "الدفترُ يختم «غير موجود» بنافذةٍ ناقصة");
    assert.ok(read("src/lib/cardDeleteGuard.ts").includes("if (!hit && !probedOk) {"), "حارسُ الحذف يحكم على نافذةٍ ناقصة");
  });

  test("٣ · بصمةُ التجاهل واحدةٌ لا نسختان — وإلّا عاد كلُّ متجاهَل", () => {
    assert.ok(LOG().includes("export function fingerprint(p: {"), "البصمةُ غيرُ مصدَّرة");
    const api = API();
    assert.ok(api.includes('import { fingerprint } from "@/lib/syncLog";'), "الـAPI لا يستورد البصمة");
    assert.equal(/function fingerprint\(r: \{/.test(api), false, "ما زالت للـAPI نسخةٌ ثانيةٌ من البصمة");
  });

  test("٤ · فرقُ ١٢ ساعةً فأقلّ ليس فرقَ تاريخ (عرفا التخزين 17:00Z و00:00Z)", () => {
    const src = SYNC();
    assert.ok(src.includes("const EXP_TOL_MS = 12 * 3600_000;"), "لا سماحيّةَ على تاريخ الانتهاء");
    assert.ok(src.includes("if (oday !== nday && !sameExpiry(p.dateTo, validDate)) {"), "فرقُ التاريخ يُرصَد بلا سماحيّة");
    assert.ok(src.includes("return sameExpiry(e, newSasExp);"), "المُصنِّفُ يطابق التاريخَ حرفيّاً");
  });

  test("٥ · «تحديث» لا يكتب إلّا ما رُصد — الملاحظاتُ في الأسماء تُصان", () => {
    const api = API();
    assert.ok(api.includes("const flagged = new Set<string>();"), "لا قائمةَ بالحقول المرصودة");
    assert.ok(api.includes('...(has("name") && r.name?.trim() ? { name: r.name } : {}),'), "الاسمُ ما زال يُكتَب بلا رصد");
    assert.ok(api.includes('...(has("phone") && r.phone?.trim() ? { phone: r.phone } : {}),'), "الهاتفُ ما زال يُكتَب بلا رصد");
    assert.ok(api.includes('...(has("package") && pkgId != null ? { packageId: pkgId } : {}),'), "الباقةُ ما زالت تُكتَب بلا رصد");
  });

  test("٦ · رقمُ ساسٍ جديدٍ ليوزرٍ قائم = **ربط**، والاستبدالُ فعلٌ صريحٌ بزرِّه", () => {
    const src = SYNC();
    assert.ok(src.includes('f: "sasLink", label: "🔗 رقمُ الساس تغيّر (أعادت الشركةُ إنشاءَ الحساب)"'), "لا رصدَ لتغيّر رقم الساس");
    assert.ok(src.includes("await closeDeadSasRows(officeId, oldByUser.sasId, u.sasId);"), "صفوفُ الرقم الميت تبقى معلّقةً أبداً");
    const api = API();
    assert.ok(api.includes('const isReplace = action === "replace";'), "الاستبدالُ ما زال يقع تلقائيّاً باختلاف الرقم");
    assert.ok(api.includes('...(has("sasLink") && r.sasId != null ? { sasId: r.sasId } : {}),'), "«تحديث» لا يربط الرقمَ الجديد");
    assert.ok(read("src/components/SyncLogModal.tsx").includes('void act([r.id], "replace")'), "لا زرَّ استبدالٍ صريحاً في الواجهة");
  });

  test("٧ · صفُّ الحالة لا تحجبه صفوفُ الأحداث المؤرَّخة", () => {
    assert.ok(
      LOG().includes('where: { towerId: p.towerId, sasId: p.sasId, kind, activatedAt: null, status: { in: ["pending", "ignored"] } },'),
      "بحثُ صفّ الحالة ما زال يبتلع صفوفَ تفعيلات الشركة المؤرَّخة",
    );
  });
});

// ═════ 🔁 دفعةُ حالات محمد الخمس (2026-08-21 مساءً) ═════
// كلُّ حالةٍ منها **مقيسةٌ على صفٍّ حيٍّ في حسابه**، وهذه حراسُها:
//   bg-5-12-11@mu  · «استبدال مشترك» نسخ رقمَ الساس **الميت** ⇒ مصنعُ التكرار.
//   bg-59-31-2@shu · وصلُ ثلاثةِ أشهرٍ وتفعيلةُ ساسٍ بشهر ⇒ صفٌّ معلَّقٌ لا يُغلق أبداً.
//   bg-1-14-2@mu   · قرضٌ (سعرُ صفر) ظهر «تفعيلاً خارجيّاً» **و**«تمديدَ أيّام» معاً.
//   bg-5-12-11@mu  · نقصُ ٥١ يوماً مقترَحٌ على مشتركٍ وصلُه مدفوعٌ للمدّة الأطول.
//   bg-13-6-3@mu   · صفّان لليوزر نفسِه ⇒ الدمجُ صار داخل المزامنة (إذنُ محمد).
describe("🔁 حالاتُ محمد الخمس", () => {
  test("استبدالُ المشترك ينقل **رقمَ الساس الحيَّ** لا رقمَ الصفّ القديم", () => {
    const rep = read("src/app/api/subscribers/[id]/replace/route.ts");
    assert.ok(rep.includes("sasId: sas.sasId ?? old.sasId,"), "الاستبدالُ ما زال ينسخ الرقمَ القديم (وقد يكون ميتاً)");
  });

  test("صفوفُ الأحداث تُغلَق بالوصل مهما قدُم تفعيلُها", () => {
    assert.ok(LOG().includes("export async function reconcileEvents("), "لا مصالحةَ لصفوف الأحداث");
    assert.ok(SYNC().includes("const closedEvents = await reconcileEvents(officeId,"), "المصالحةُ لا تُنادى من المزامنة");
  });

  test("سعرُ صفرٍ = قرضٌ دائماً، والقرضُ يُسجَّل مختوماً لا معلَّقاً", () => {
    const src = SYNC();
    assert.ok(src.includes("const isLoanAct = Math.round(a.price || 0) <= 0;"), "شرطُ «بلا كارت» ما زال يُسقط قروضاً حقيقيّة");
    assert.ok(LOG().includes('...(p.loan ? { note: LOAN_NOTE, status: "done", handledAt: new Date() } : {}),'), "القرضُ ما زال يُزاحم العملَ في التبويب");
  });

  test("لا ازدواجَ: فرقُ أيّامٍ لا يُرصَد لمن له صفُّ حدثٍ معلَّق", () => {
    assert.ok(SYNC().includes('kind: { in: ["sas", "self", "install"] }, status: "pending", activatedAt: { not: null } },'), "لا فحصَ لصفّ حدثٍ قائمٍ قبل رصد فرق الأيّام");
  });

  test("نقصُ الأيّام لا يُرصَد إذا كان تاريخُنا مدفوعاً بوصل", () => {
    assert.ok(SYNC().includes("if (!classified && !grew && p.dateTo) {"), "النقصُ يُرصَد بلا سؤالٍ عن الوصل");
    assert.ok(SYNC().includes("paid.to.some((t) => Math.abs(t - p.dateTo!.getTime()) <= RECEIPT_NEAR_MS)"), "لا مقارنةَ بين انتهاء الوصل وتاريخنا");
  });

  test("دمجُ المكرَّرين داخل المزامنة — وصاحبُ المال يبقى، ومالٌ في صفَّين لا يُمَسّ", () => {
    const src = SYNC();
    assert.ok(src.includes("async function mergeDuplicateNetUsers("), "لا دمجَ تلقائيّاً للمكرَّرين");
    assert.ok(src.includes("await mergeDuplicateNetUsers(officeId);"), "الدمجُ لا يُنادى");
    assert.ok(src.includes("if (money.size > 1) { report.skippedMoney++; continue; }"), "🛡️ مجموعةٌ فيها مالٌ بصفَّين قد تُمَسّ");
    // 🔴 وعطلُ مجموعةٍ واحدةٍ كان يُجهض الحلقةَ كلَّها بصمت (فيبدو أنّ «لا شيء تغيّر»)
    assert.ok(src.includes("report.errors.push(`${ukey}:"), "عطلُ مجموعةٍ ما زال يُسقط الدمجَ كلَّه بصمت");
    assert.ok(src.includes("export type MergeReport ="), "الدمجُ بلا تقريرٍ يُقرأ");
    assert.ok(src.includes("const keeper = group.find((g) => money.has(g.id))"), "الباقي ليس صاحبَ المال");
    assert.ok(src.includes("MERGE_DUP_NETUSER"), "الدمجُ بلا أثرِ تدقيق");
  });

  test("الكارتُ الذي أثبتت النافذةُ استعمالَه تسقط عنه تهمةُ «الوهميّة» تلقائيّاً", () => {
    const src = SYNC();
    assert.ok(src.includes('action: "PHANTOM_CARD_LINK", entity: "rechargeCard"'), "الوسمُ الكاذبُ يبقى في لوحة المدير");
  });
});

// 🔴 الفهرسُ الفريدُ (towerId, sasId) — سببُ سقوط ٢٥ مجموعةً من ٢٦ في أوّل تشغيلٍ حيّ
test("الدمجُ يُفرّغ المكرَّرَ من رقم الساس **قبل** أن يرثه الباقي", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/subscriptionSync.ts"), "utf8");
  const tx = src.slice(src.indexOf("await prisma.$transaction(async (tx) => {"), src.indexOf("}, { timeout: 20_000 });"));
  const iOthers = tx.indexOf("for (const o of others) {");
  const iKeeper = tx.indexOf("where: { id: keeper.id },");
  assert.ok(iOthers > -1 && iKeeper > -1, "بنيةُ المعاملة تغيّرت");
  assert.ok(iOthers < iKeeper, "الباقي يرث الرقمَ قبل تفريغ المكرَّر ⇒ ارتطامٌ بالفهرس الفريد");
});
