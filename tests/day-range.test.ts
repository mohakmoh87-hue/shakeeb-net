import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ ب-٨ · نافذةُ «يومٍ» بتوقيت بغداد لا بتوقيت الخادم ═════
//
// 🔴 كانت ١١ موضعاً تبني نهايةَ اليوم بـ`setHours(23,59,59,999)` (أو `new Date(d+"T23:59:59")`
//   بلا `Z`) — وكلاهما يُحلَّل بتوقيت **العمليّة**، وهي UTC على الخادم ⇒ نافذةٌ مُزاحةٌ
//   **+٣ ساعات**: تُفوَّت ٠٠:٠٠–٠٣:٠٠ من اليوم وتُضَمّ ثلاثٌ من الغد. فتُخالف تقاريرُ
//   المدى **الصندوقَ والتقريرَ اليوميّ** اللذين يستعملان `baghdadDayKey` صحيحاً.
//
// 🎯 والأثرُ مقيسٌ على الإنتاج: **٩ قيودٍ ماليّة** في نافذة الخلاف بمجموع **٢٨٠٬٠٠٠ د.ع**.
//
// ✅ وشرطُ محمد: «لا مشكلةَ إذا تغيّر قيدُ يومٍ ما دام **المبلغُ الكلّيُّ يبقى نفسَه ومبلغُ
//   الماستر يبقى نفسَه**». وهو محفوظٌ **بنيويّاً**: هذه الوحدةُ تُبنى بها حدودُ استعلامٍ
//   فقط — لا تكتب صفّاً ولا تُعدّل مبلغاً. فالمجاميعُ لا تتغيّر، وإنّما يُنسَب القيدُ ليومه.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const H = 3600_000;

describe("ب-٨ · نافذةُ اليوم بتوقيت بغداد", () => {
  test("بدايةُ اليوم = منتصفُ الليل بغداد = ٢١:٠٠Z من اليوم السابق", async () => {
    const { baghdadStart } = await import("../src/lib/dayRange");
    const d = baghdadStart("2026-08-13")!;
    assert.equal(d.toISOString(), "2026-08-12T21:00:00.000Z");
  });

  test("نهايةُ اليوم = ٢٣:٥٩:٥٩.٩٩٩ بغداد = ٢٠:٥٩:٥٩.٩٩٩Z من اليوم نفسِه", async () => {
    const { baghdadEnd } = await import("../src/lib/dayRange");
    const d = baghdadEnd("2026-08-13")!;
    assert.equal(d.toISOString(), "2026-08-13T20:59:59.999Z");
  });

  test("🎯 والنافذةُ تطبق يوماً كاملاً بالضبط — ٢٤ ساعةً ناقصةً مِلّي", async () => {
    const { baghdadStart, baghdadEnd } = await import("../src/lib/dayRange");
    const a = baghdadStart("2026-08-13")!.getTime();
    const b = baghdadEnd("2026-08-13")!.getTime();
    assert.equal(b - a, 24 * H - 1, "طولُ النافذة ليس يوماً كاملاً");
  });

  test("🎯 والقيدُ الذي كان يُنسَب لليوم الخطأ صار في يومه", async () => {
    const { baghdadStart, baghdadEnd } = await import("../src/lib/dayRange");
    // قيدٌ حقيقيٌّ من الإنتاج: مخزَّنٌ ٢٠٢٦-٠٨-١٢T٢١:٠٩Z = **٠٠:٠٩ بغداد من ١٣ آب**
    const tx = new Date("2026-08-12T21:09:01.089Z");
    const in12 = tx >= baghdadStart("2026-08-12")! && tx <= baghdadEnd("2026-08-12")!;
    const in13 = tx >= baghdadStart("2026-08-13")! && tx <= baghdadEnd("2026-08-13")!;
    assert.equal(in12, false, "ما زال يُنسَب لليوم السابق (١٢ آب)");
    assert.equal(in13, true, "لا يُنسَب ليومه الصحيح (١٣ آب)");
  });

  test("نصٌّ يحمل وقتاً صريحاً يُترَك كما هو — فلا تُفسَد نيّةُ المتّصل", async () => {
    const { baghdadStart, baghdadEnd } = await import("../src/lib/dayRange");
    const iso = "2026-08-13T10:30:00.000Z";
    assert.equal(baghdadStart(iso)!.toISOString(), iso);
    assert.equal(baghdadEnd(iso)!.toISOString(), iso);
  });

  test("قيمةٌ فارغةٌ أو فاسدةٌ ⇒ `null` — فلا يُبنى مدًى من قمامة", async () => {
    const { baghdadStart, baghdadEnd } = await import("../src/lib/dayRange");
    for (const bad of [null, undefined, "", "  ", "abc", "2026-13-99x"]) {
      assert.equal(baghdadStart(bad as string | null), null, `قُبِل: ${String(bad)}`);
      assert.equal(baghdadEnd(bad as string | null), null, `قُبِل: ${String(bad)}`);
    }
  });

  test("🛡️ لا `setHours(23,...)` باقٍ في أيّ مسارِ تقريرٍ أو مال", () => {
    const roots = ["src/app/api"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith(".ts")) {
          const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
          if (/setHours\(23,\s*59,\s*59/.test(src)) offenders.push(rel);
          // و`new Date(d + "T23:59:59")` بلا `Z` — العلّةُ نفسُها بشكلٍ آخر
          if (/new Date\([^)]*\+\s*"T23:59:59"\)/.test(src)) offenders.push(`${rel} (T23:59:59 بلا Z)`);
        }
      }
    };
    for (const r of roots) walk(r);
    assert.deepEqual(offenders, [], `مواضعُ تبني نهايةَ اليوم بتوقيت الخادم:\n  - ${offenders.join("\n  - ")}`);
  });

  test("🔒 والإصلاحُ لا يكتب شيئاً — شرطُ محمد على المجاميع محفوظٌ بنيويّاً", () => {
    const lib = read("src/lib/dayRange.ts");
    for (const f of ["prisma", "update", "create", "delete"]) {
      assert.equal(lib.includes(f), false, `وحدةُ الحدود تمسّ البيانات: ${f}`);
    }
  });
});
