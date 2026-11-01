import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sasInstant, sasExpiry } from "@/lib/sas4";
import { TZ_DUP_MARK, TZ_SHIFT_MS } from "@/lib/syncLog";

// ═════ 🕒 تفعيلةٌ واحدةٌ بلحظةٍ واحدةٍ على أيّ جهاز (بلاغُ محمد 2026-11-01 — كاسبر) ═════
//
// الساسُ يعطي `2026-10-30 16:15:15` بلا منطقةٍ زمنيّة، و`new Date` تفسّره بتوقيت **الجهاز**:
// الخادمُ (UTC) يحفظ 16:15Z وحاسبةُ المكتب (بغداد) تحفظ 13:15Z ⇒ صفّان لتفعيلةٍ واحدة،
// ومفتاحُ منع التكرار (اللحظةُ بالثانية) لا يراهما تكراراً. قياسُ الشهر العاشر: ٢٨٩٤ زوجاً
// في سبعة مكاتب (كاسبر ١٣٨٨) ⇒ أرباحُ كاسبر ٣٦٢٠ تفعيلاً مقابل ٢٧٩٢ في ملفّ الساس.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SRC_DIRS = ["src/lib", "src/app"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

describe("🕒 نصُّ تاريخِ الساس يُفسَّر بمنطقته صراحةً", () => {
  test("لحظةُ التفعيل بـ+03:00 وتاريخُ الانتهاء بـZ", () => {
    assert.equal(sasInstant("2026-10-30 16:15:15")?.toISOString(), "2026-10-30T13:15:15.000Z");
    assert.equal(sasExpiry("2026-10-30 16:15:15")?.toISOString(), "2026-10-30T16:15:15.000Z");
  });

  test("نصٌّ يحمل منطقتَه يُحترَم كما هو، والفاسدُ يعيد null", () => {
    assert.equal(sasInstant("2026-10-30T13:15:15Z")?.toISOString(), "2026-10-30T13:15:15.000Z");
    assert.equal(sasExpiry(""), null);
    assert.equal(sasExpiry("N/A"), null);
  });

  test("🔑 الفارقُ بين الدالّتين ثلاثُ ساعاتٍ بالضبط — وهو حجمُ العلّة", () => {
    const i = sasInstant("2026-10-30 16:15:15")!.getTime();
    const e = sasExpiry("2026-10-30 16:15:15")!.getTime();
    assert.equal(e - i, TZ_SHIFT_MS);
  });

  test("🛡️ لا `new Date` على أيّ حقل تاريخٍ من الساس في كلّ المشروع", () => {
    const bad = /new Date\([A-Za-z_$][A-Za-z0-9_$]*\.(createdAt|created_at|expiration|oldExpiration|newExpiration)\b/;
    const hits: string[] = [];
    for (const d of SRC_DIRS) for (const f of walk(d)) if (bad.test(read(f))) hits.push(f);
    assert.deepEqual(hits, [], "تفسيرٌ بتوقيت الجهاز عاد — تفعيلةٌ واحدةٌ ستُسجَّل مرّتين");
  });
});

describe("🛡️ حارسُ النسخة المزاحة", () => {
  test("فحصُ وجود الصفّ يشمل اللحظةَ ونسختَيها المزاحتَين", () => {
    const s = read("src/lib/syncLog.ts");
    assert.match(s, /function tzWindow\(at: Date\): Date\[\]/, "نافذةُ التسامح غائبة");
    assert.match(s, /\[at, new Date\(at\.getTime\(\) \+ TZ_SHIFT_MS\), new Date\(at\.getTime\(\) - TZ_SHIFT_MS\)\]/, "النسختان غيرُ محسوبتَين");
    const n = s.match(/activatedAt: \{ in: tzWindow\(p\.activatedAt\) \}/g) ?? [];
    assert.equal(n.length, 2, "الحارسُ لم يُطبَّق على المسارَين (تفعيلٌ + تفعيلُ شركة)");
  });

  test("ومحرّكُ الأرباح يتجاهل الموسومةَ ولا يحذفها", () => {
    const p = read("src/lib/profits.ts");
    assert.match(p, /if \(\(r\.note \?\? ""\)\.includes\(TZ_DUP_MARK\)\) continue;/, "المحرّكُ ما زال يعدّ النسخةَ المزاحة");
    assert.ok(TZ_DUP_MARK.length > 6, "الوسمُ قصيرٌ فيصطاد ملاحظاتٍ أخرى");
    assert.ok(!/delete|deleteMany/.test(read("src/lib/syncLog.ts").slice(read("src/lib/syncLog.ts").indexOf("TZ_DUP_NOTE"), read("src/lib/syncLog.ts").indexOf("TZ_DUP_NOTE") + 400)), "حذفٌ قرب الوسم");
  });
});
