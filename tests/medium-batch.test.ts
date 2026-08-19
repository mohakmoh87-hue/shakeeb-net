import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ الاثنتان والعشرون المتوسّطة + الرقابتان (2026-08-19) — حراسُ البقاء ═════
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("الحالاتُ البالِعة والفشلُ الصامت (lib)", () => {
  test("١٩ · غيرُ المربوطة تجدّد ختمَ ready لمِلكها بعد مسبارٍ صادق", () => {
    const c = code("src/lib/whatsapp.ts");
    assert.ok(/if \(await ensureReadyIsReal\(id\) && mid\)/.test(c), "غيرُ المربوطة لا تجدّد الختم — مكاتبُها «غير متصل» أبداً");
    assert.ok(/towerId: id, hostMachineId: mid/.test(c), "التجديدُ بلا شرطِ الملكيّة — يدهس حاسبةً أخرى");
  });
  test("٢٠ · مفتاحُ إبطال جلسة أودو = مفتاحُ خزنها (panelId ?? id)", () => {
    const c = code("src/lib/odooSync.ts");
    assert.ok(!/sessionCache\.delete\(o\.id\)/.test(c), "عاد الإبطالُ بمفتاحٍ خاطئ — جلسةُ اللوحة الميّتة تُحبَس");
    assert.ok((c.match(/sessionCache\.delete\(o\.panelId \?\? o\.id\)/g) ?? []).length >= 3, "مواضعُ الإبطال ناقصة");
  });
  test("٢١ · printing العالقة تعود pending بعد ١٠ دقائق", () => {
    const c = code("src/lib/printAgent.ts");
    assert.ok(/status: "printing", updatedAt: \{ lt: new Date\(Date\.now\(\) - 10 \* 60_000\) \}/.test(c), "printing حالةٌ بالِعةٌ ثانية");
  });
  test("٢٢+٢٥ · ختمُ النتيجة يُعاد ثلاثاً ويصرخ، ومهلةُ «التنفيذ جارٍ» تُختَم بصدق", () => {
    const c = code("src/lib/broadcastQueue.ts");
    assert.ok(/for \(let attempt = 0; attempt < 3 && !stamped/.test(c), "ختمُ SENT مبتلَعُ الفشل — recover سيُكرّر الرسالة");
    assert.ok(/غيرُ مؤكَّدة/.test(c), "مهلةُ التنفيذ الجاري تُختَم كفشلِ رقمٍ كاذب");
  });
  test("٢٣ · الإغلاقُ والغرامةُ معاملةٌ واحدة", () => {
    const c = code("src/lib/autoCheckout.ts");
    assert.ok(/\$transaction\(async \(tx\) => \{[\s\S]*?tx\.attendance\.updateMany[\s\S]*?tx\.adjustment\.create/.test(c),
      "الغرامةُ خارج معاملة الإغلاق — فشلُها يضيّعها إلى الأبد");
  });
  test("٢٤ · فشلُ قراءة الإجازة يُرمى بعد إعادةٍ — لا «لا إجازة» كاذبة", () => {
    const c = code("src/lib/field.ts");
    assert.ok(!/\}\)\.catch\(\(\) => null\);\s*\n\s*return l\?\.startMin/.test(c), "عاد catch الصامت — يُخصَم وقتٌ مأذون");
  });
  test("٢٨ · resyncSequence يصرخ باسم الجدول", () => {
    assert.ok(/تعذّر ضبطُ تسلسل/.test(code("src/lib/backup.ts")), "فشلُ التسلسل صامتٌ ثانية");
  });
  test("٢٩ · تحريرُ ملكيّة الجلسة يُعاد ثلاثاً ويصرخ", () => {
    assert.ok(/تعذّر تحريرُ ملكيّة جلسة/.test(code("src/lib/whatsapp.ts")), "فشلُ التحرير مبتلَعٌ ثانية");
  });
});

describe("المرايا والسباقات (api)", () => {
  test("٣٠ · تصحيحُ المدّة يواكب تاريخَ المشترك إن كان من هذا الوصل", () => {
    const c = code("src/app/api/manager/card-guard/route.ts");
    assert.ok(/sub\.dateTo\.getTime\(\) === entry\.dateTo\.getTime\(\)/.test(c), "النسختان تفترقان ثانية");
  });
  test("٣١ · إعادةُ تسمية الفنيّ تواكب حسابَه الماليّ", () => {
    const c = code("src/app/api/field/technicians/route.ts");
    assert.ok(/data: \{ name: data\.name\.trim\(\) \}/.test(c), "اسمُ الحساب الماليّ يبقى القديم");
  });
  test("٣٢ · ترقيمُ الفواتير تحت قفلٍ استشاريٍّ واحدٍ في المسارَين", () => {
    assert.ok(/pg_advisory_xact_lock\(823001\)/.test(code("src/app/api/invoices/route.ts")), "فاتورتان بنفس الرقم (بيع)");
    assert.ok(/pg_advisory_xact_lock\(823001\)/.test(code("src/app/api/field/complete/route.ts")), "فاتورتان بنفس الرقم (صيانة)");
  });
  test("٣٣ · رقمُ العقدة: القفلُ يشمل الكتابةَ نفسَها", () => {
    const c = code("src/app/api/hybrid/heartbeat/route.ts");
    assert.ok(/pg_advisory_xact_lock\(823002\)[\s\S]*?tx\.hybridWorker\.upsert/.test(c),
      "القفلُ لا يشمل upsert — حاسبتان بنفس رقم العقدة");
  });
  test("٣٤ · كلُّ علامات الزوج تُجرَّب والتبادلُ فيصل", () => {
    const c = code("src/app/api/manager-accounts/tx/route.ts");
    assert.ok(/matchAll\(\/زوج #/.test(c) && /for \(const pairId of pairIds\)/.test(c), "أوّلُ علامةٍ وحدَها تُقرأ — نصُّ المستخدم يحجب الحقيقيّة");
  });
});

describe("الواجهاتُ الخرساء", () => {
  test("٢٧ · تبويبُ التقرير الفاشل يُقال ولا يكذب", () => {
    assert.ok(/الأرقامُ المعروضةُ ما زالت للتبويب السابق/.test(read("src/components/DailyReportCard.tsx")), "أرقامُ مكتبٍ باسم آخر");
  });
  test("٣٦+٣٧+٣٨ · الهجين والمكاتب والديون تُبلّغ الفشلَ بأصحابه", () => {
    assert.ok(/تعذّر تغييرُ الاعتماد/.test(read("src/app/(app)/hybrid/page.tsx")), "٣٦ أخرس");
    assert.ok(/تعذّر حذفُ المكتب/.test(read("src/app/(app)/towers/page.tsx")), "٣٧ أخرس");
    assert.ok(/فشل \$\{failed\.length\}/.test(read("src/app/(app)/debts/page.tsx")), "٣٨ يطوي الإخفاقات");
  });
});

describe("الرقابتان", () => {
  test("أ · سجلُّ الحاسبة: التقاطٌ حلقيٌّ يُرفَع مع النبضة ويُعرَض للمدير", () => {
    const h = code("src/lib/hybridAgent.ts");
    assert.ok(/__waLogRing/.test(h) && /lastLog: lastLogText\(\)/.test(h), "النبضةُ لا ترفع السجلّ");
    assert.ok(/orig\(\.\.\.args\)/.test(h), "الالتقاطُ يمنع الطباعةَ الأصليّة — نافذةُ العامل تصمت");
    assert.ok(/lastLog/.test(code("src/app/api/hybrid/workers/route.ts")), "المسارُ لا يُرجع السجلّ");
    assert.ok(/📜 السجلّ/.test(read("src/app/(app)/hybrid/page.tsx")), "لا زرَّ عرضٍ للسجلّ");
  });
  test("ب · ملخّصُ الأعطال يركب تقريرَ المدير بعزل الوكيل", () => {
    const c = code("src/lib/scheduler.ts");
    assert.ok(/ملخّصُ الأعطال/.test(c), "لا ملخّصَ أعطال");
    assert.ok(/action: "CLIENT_ERROR", userId: \{ in: uids \}/.test(c), "أخطاءُ الواجهة بلا عزل الوكيل");
    assert.ok(/message\.count\(\{ where: \{ agentId, status: "FAILED"/.test(c), "الرسائلُ الفاشلة بلا عزل");
    assert.ok(/يُرسل التقريرُ بدونه/.test(read("src/lib/scheduler.ts")), "فشلُ الملخّص قد يُسقط التقريرَ كلَّه");
  });
});
