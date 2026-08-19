import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ إغلاقُ ملفّ الـ١٦ علّةَ تنفيذٍ مزدوج (فُتح 2026-08-10 · أُغلق 2026-08-19) ═════
//
// عند الفتح تبيّن أنّ الأصول ١ و٣ و٤ و٥ أُغلقت سلفاً في دفعة ب-١ (2026-08-13) —
// والذاكرةُ كانت متقادمة. فهذا الملفُّ يُثبّت أنماطَ الإغلاق الخمسةَ كلَّها اختباراً:
// أيُّ تراجعٍ عن أيٍّ منها (بدمجٍ أو إعادة كتابة) يسقط هنا باسمه، لا في هاتف مشترك.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("الأصل ١ · القيادةُ إجارةٌ ذرّيّةٌ لا رايةَ ذاكرة", () => {
  test("acquireLeadership مقارنةٌ-وتبديلٌ بساعة القاعدة، والفاقدُ يُطلق فوراً", () => {
    const c = code("src/lib/hybridLeader.ts");
    assert.ok(/leaderUntil.*<.*NOW\(\) AT TIME ZONE 'UTC'/s.test(c), "الإجارةُ لا تُنتزَع بشرط الانتهاء الذرّيّ");
    assert.ok(/releaseLeadership/.test(code("src/lib/hybridAgent.ts")), "فاقدُ الاستحقاق لا يُطلق الإجارة");
    // وفشلُ الحجز يسقط إلى السلوك القديم لا إلى تعطيل النظام (درسُ ساعة التعطيل)
    assert.ok(/return true;\s*\n\s*\}\s*\n\}/.test(read("src/lib/hybridLeader.ts").slice(0, read("src/lib/hybridLeader.ts").indexOf("releaseLeadership"))),
      "فشلُ الحجز يعطّل القيادةَ بدل السقوط للاستحقاق");
  });
});

describe("الأصل ٢ · حجزُ اليوم قبل العمل — والمظلّةُ الفرديّةُ فوقه", () => {
  test("التذكيرُ والديونُ والنسختان: الحجزُ بشرطٍ داخل WHERE", () => {
    const s = code("src/lib/scheduler.ts");
    assert.ok(/lastReminderDate: \{ not: todayK \}/.test(s), "تذكيرُ الانتهاء بلا حجزِ يوم");
    assert.ok(/lastDebtReminderDate: \{ not: todayK \}/.test(s), "الديونُ بلا حجزِ يوم");
    const b = code("src/lib/backupJob.ts");
    assert.ok(/"lastBackupDate" IS NULL OR "lastBackupDate" <>/.test(b), "نسخةُ الوكيل بلا حجزٍ ذرّيّ");
    assert.ok(/won\.count !== 1|claimedRow/.test(b), "نسخةُ المالك بلا حجزٍ ذرّيّ");
  });
  test("🔴 الخاتمة (2026-08-19): الحلقتان تحت مظلّة فهرس التكرار الفرديّ", () => {
    const s = code("src/lib/scheduler.ts");
    assert.ok(/alreadySentToday\(sub\.id, "expiring"/.test(s),
      "الزرُّ اليدويُّ بعد المُجدول = رسالتا انتهاءٍ لنفس المشترك");
    assert.ok(/alreadySentToday\(sub\.id, "debts"/.test(s),
      "مسارا الديون (مُجدول + زرّ) بلا حارسٍ فرديٍّ مشترك");
    assert.ok(/dedupKey: messageDedupKey\(office\?\.agentId \?\? null, sub\.id, "expiring"\)/.test(s), "سجلُّ التذكير خارج الفهرس");
    assert.ok(/dedupKey: messageDedupKey\(office\?\.agentId \?\? null, sub\.id, "debts"\)/.test(s), "سجلُّ الديون خارج الفهرس");
  });
});

describe("الأصل ٣ · الحجزُ الفعليُّ هو حارسُ النسخة الواحدة", () => {
  test("لا مِسبارَ يُغلق، وEADDRINUSE قاتلٌ قبل أيّ أثر", () => {
    const w = code("src/worker.ts");
    assert.ok(/await startLocalSasServer\("exit"\)/.test(w), "الحجزُ ليس أوّلَ سطرٍ مؤثّر");
    // ترتيبُ **النداءَين** (تعريفُ الدالّة أعلى الملفّ لا يعنينا): القفلُ ثمّ القتل
    assert.ok(/await startLocalSasServer\("exit"\);[\s\S]*?killOrphanBrowsers\(\);/.test(w),
      "قتلُ المتصفّحات قبل القفل — الخاسرُ يقتل جلسات الرابح");
    assert.ok(/EADDRINUSE/.test(code("src/lib/localSasServer.ts")), "EADDRINUSE مبتلَعٌ ثانية");
  });
});

describe("الأصل ٤ · لا يُفَكّ حجزٌ بعد أثرٍ خارجيٍّ لا يُسترَدّ", () => {
  test("نشرُ ملاحظة أودو مُعلَّمٌ (odooNotedAt) والحجوزُ claim.count===1", () => {
    const c = code("src/lib/odooSync.ts");
    assert.ok(/if \(notedAt\) return;/.test(c), "الملاحظةُ تُنشَر ثانيةً عند إعادة المحاولة (~١٨٠/ساعة)");
    assert.ok((c.match(/claim(?:ed)?\.count !== 1\) continue/g) ?? []).length >= 4, "حجوزُ الدفع/الإنذار ناقصة");
  });
});

describe("الأصل ٥ · المزامنةُ اليدويّة حجزٌ ذرّيٌّ لا فحصٌ-ثمّ-كتابة", () => {
  test("claimManualSync قبل الإطلاق، والثاني ينضمّ لا يُكرّر", () => {
    const c = code("src/app/api/offices/[id]/sync/route.ts");
    assert.ok(/claimManualSync\(towerId\)/.test(c), "عاد الفحصُ-ثمّ-كتابة — مزامنتان وتقريران للمدير");
    assert.ok(/joined: true/.test(c), "الضغطةُ الثانية لا تنضمّ");
  });
});
