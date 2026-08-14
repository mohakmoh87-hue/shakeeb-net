import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ 🔒 كلُّ جدولٍ فيه عزلٌ له سياسةٌ **في ملفّات المرجع** (2026-08-14) ═══════
//
// 🔴 **الفجوةُ التي كشفها هذا الاختبارُ يومَ كتابته — خمسةُ جداول**:
//   • `deleted_card_logs` · `guard_assignments` · `card_sas_checks` — أُنشئت اليومَ
//     بسياساتها **من سكربتِ نشرٍ** ولم تُذكَر هنا.
//   • `sas_panels` · `money_health_ignores` — **لهما سياسةٌ على الإنتاج فعلاً** (من
//     سكربتَي نشرِهما القديمَين) وكانتا غائبتَين عن هذا الملفّ.
//   ⇒ فاستعادةٌ من نسخةٍ احتياطيّة (وهي ثلاثُ خطواتٍ موثَّقةٌ في RECOVERY) كانت
//   **تُعيدها بلا عزلٍ ولا أذون**، فأوّلُ قراءةٍ من حاسبةِ مكتبٍ تسريبٌ بين الوكلاء.
//   وثلاثةٌ منها (`managers` · `card_completions` · `map_point_proposals`) بلا سياسةٍ
//   على الإنتاج أصلاً — وهي التي يُبلّغ عنها `npm run check:money`.
//
// 🔑 والقاعدةُ التي يحرسها: **كلُّ كتابةٍ جديدة = GRANT + سياسة — في ملفّات المرجع**،
//   لا في سكربتٍ عابرٍ يُشغَّل مرّةً وينتهي. فالسكربتُ يُصلح الإنتاجَ الحاليّ، وهذان
//   الملفّان يُصلحان **كلَّ تزويدٍ قادم**.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** جداولُ السكيمة التي تحمل عمودَ عزلٍ (`agentId`) ⇒ يلزمها سياسة. */
function isolatedTables(): { model: string; table: string }[] {
  const schema = read("prisma/schema.prisma");
  const out: { model: string; table: string }[] = [];
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const model = block.slice(0, block.indexOf(" ")).trim();
    const body = block.slice(0, block.indexOf("\n}"));
    const map = /@@map\("([^"]+)"\)/.exec(body);
    if (!map) continue;
    // عمودُ `agentId` معلَناً في النموذج (لا في تعليق)
    const hasAgent = body.split(/\r?\n/).some((l) => /^\s*agentId\s+Int/.test(l));
    if (hasAgent) out.push({ model, table: map[1] });
  }
  return out;
}

describe("🔒 تغطيةُ العزل في ملفّات المرجع", () => {
  const tables = isolatedTables();

  test("السكيمةُ تُقرَأ وفيها جداولُ عزلٍ كثيرة — فالاختبارُ يقيس شيئاً", () => {
    assert.ok(tables.length >= 20, `جداولُ العزل ${tables.length} — الاستخراجُ معطوب`);
  });

  test("🔴 كلُّ جدولٍ فيه `agentId` له سياسةٌ في 03-policies.sql", () => {
    const pol = read("prisma/rls/03-policies.sql");
    const naked = tables.filter((t) => !pol.includes(t.table)).map((t) => t.table);
    assert.deepEqual(naked, [], `جدولُ عزلٍ بلا سياسةٍ في ملفّ المرجع — استعادةٌ تُعيده مكشوفاً: ${naked.join(" · ")}`);
  });

  test("وجداولُ حارس المال الثلاثُ حاضرةٌ بأذونها وتسلسلاتها", () => {
    const pol = read("prisma/rls/03-policies.sql");
    const gr = read("prisma/rls/02-grants.sql");
    for (const t of ["deleted_card_logs", "guard_assignments", "card_sas_checks"]) {
      assert.ok(pol.includes(`rls_${t}`), `لا سياسةَ لـ${t}`);
      assert.ok(pol.includes(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), `RLS غيرُ مُشغَّلٍ لـ${t}`);
      assert.ok(gr.includes(t), `لا أذونَ لـ${t}`);
      // والتسلسلُ أيضاً — وإلّا فشل الإدخالُ من حاسبةِ المكتب بلا سببٍ ظاهر
      assert.ok(gr.includes(`${t}_id_seq`), `تسلسلُ ${t} بلا GRANT — فيفشل الإدخالُ من العامل`);
    }
  });

  test("والخمسةُ التي اصطادها الاختبارُ صارت في المرجع", () => {
    const pol = read("prisma/rls/03-policies.sql");
    for (const t of ["sas_panels", "money_health_ignores", "managers", "card_completions", "map_point_proposals"]) {
      assert.ok(pol.includes(`rls_${t}`), `لا سياسةَ لـ${t}`);
    }
  });

  test("وكلُّ سياسةٍ تحمل شرطَ عزلٍ **بحسبِ أمرِها**", () => {
    const pol = read("prisma/rls/03-policies.sql");
    const isolated = new Set(tables.map((t) => t.table));
    const bad: string[] = [];
    // ⚠️ **ومقياسُ الشرطِ يتبع الأمر** — أوّلُ صيغةٍ لهذا الاختبار أخرجت ستَّ سياساتٍ
    //   «ناقصة» وهي سليمةٌ تماماً: سياسةُ `FOR INSERT` ليس لها `USING` أصلاً (لا صفوفَ
    //   تُقرَأ)، وسياسةُ `FOR SELECT` ليس لها `WITH CHECK` (لا كتابة). فمطالبةُ الطرفَين
    //   من كلّ سياسةٍ **خطأٌ في المقياس لا في العزل**. والعزلُ كذلك ليس بـ`agentId` دائماً.
    for (const m of pol.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+(\w+)[\s\S]*?;/g)) {
      const body = m[0];
      const tbl = m[2];
      const forCmd = /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.exec(body)?.[1]?.toUpperCase() ?? "ALL";
      const needUsing = forCmd !== "INSERT";
      const needCheck = forCmd === "INSERT" || forCmd === "UPDATE" || forCmd === "ALL";
      if (needUsing && !/USING\s*\(/.test(body)) { bad.push(`${tbl} (${forCmd}: بلا USING)`); continue; }
      if (needCheck && !/WITH CHECK\s*\(/.test(body)) { bad.push(`${tbl} (${forCmd}: بلا WITH CHECK)`); continue; }
      // ⚠️ **ودالّةُ العزل تُطلَب من جداولِ `agentId` وحدَها**: صيغةٌ سابقةٌ طلبتها من
      //   الجميع فأخرجت `push_types` و`audit_logs` وهما سليمتان بقصد — الأولى مرجعٌ
      //   مشتركٌ للقراءة (`USING (true)`) والثانية إدخالٌ بشرطِ `userId IS NULL`.
      //   فالمقياسُ يتبع طبيعةَ الجدول لا شكلَ السياسة.
      if (isolated.has(tbl) && !/current_agent_id\(\)|current_tower|agent_tower/.test(body)) {
        bad.push(`${tbl} (جدولُ عزلٍ بشرطٍ بلا دالّةِ عزل)`);
      }
    }
    assert.deepEqual(bad, [], `سياسةٌ ناقصةُ الشرط: ${bad.join(" · ")}`);
  });
});
