import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// 🔴 حادثةُ 2026-10-24: أُضيف عمودُ `appNickname` إلى **جدول المشتركين** بإنشاءٍ كسولٍ
// داخل `ensureMarketTable`. والكسولُ يصلح لجدولٍ **جديد** لا يقرؤه غيرُ مساره — ولا
// يصلح لعمودٍ على جدولٍ **قائم**: Prisma يُدرج العمودَ في كلّ استعلامٍ بلا `select`،
// في كلّ المسارات دفعةً واحدةً لحظةَ النشر. فانهار تفعيلُ المشتركين كلُّهم
// (`subscriber.findUnique` بلا select) حتّى نُفِّذ الـALTER على الإنتاج يدويّاً.
// القاعدةُ التي خولفت: **العمودُ يُضاف على الإنتاج قبل نشر الكود الذي يقرؤه.**

// جداولٌ مركزيّةٌ تُقرأ من مساراتٍ كثيرةٍ بلا `select` — عمودٌ جديدٌ فيها لا يُسلَّم كسولاً
const CORE_TABLES = [
  "subscribers", "users", "towers", "agents", "packages", "items", "money_tx",
  "manager_tx", "invoices", "receipts", "task_cards", "technicians",
];

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) srcFiles(rel, out);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

describe("🔒 الإنشاءُ الكسولُ لا يمسّ أعمدةَ الجداول المركزيّة", () => {
  const files = srcFiles("src");

  test("لا ALTER TABLE ... ADD COLUMN على جدولٍ مركزيٍّ في كود التشغيل", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of src.matchAll(/ALTER\s+TABLE\s+"?([A-Za-z_]+)"?\s+ADD\s+COLUMN/gi)) {
        const table = m[1].toLowerCase();
        if (CORE_TABLES.includes(table)) offenders.push(`${f} → ${table}`);
      }
    }
    assert.deepEqual(
      offenders, [],
      "عمودٌ جديدٌ على جدولٍ مركزيٍّ لا يُسلَّم بإنشاءٍ كسول — يُنفَّذ ALTER على الإنتاج أوّلاً ثمّ يُنشَر الكود",
    );
  });

  test("والكسولُ يبقى مسموحاً لجداولِ الميزات الجديدة", () => {
    const market = fs.readFileSync(path.join(ROOT, "src/lib/market.ts"), "utf8");
    assert.ok(market.includes('CREATE TABLE IF NOT EXISTS "market_comments"'), "جدولُ التعليقات ينشأ كسولاً");
    const agent = fs.readFileSync(path.join(ROOT, "src/lib/agentAppOffers.ts"), "utf8");
    assert.ok(agent.includes('CREATE TABLE IF NOT EXISTS "agent_offers"'), "جداولُ العروض تنشأ كسولاً");
  });

  test("كلُّ ALTER ... ADD COLUMN باقٍ يحمل IF NOT EXISTS (إضافةٌ لا تكسر إعادةَ التشغيل)", () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of src.matchAll(/ALTER\s+TABLE\s+"?[A-Za-z_]+"?\s+ADD\s+COLUMN(?!\s+IF\s+NOT\s+EXISTS)/gi)) {
        assert.fail(`${f}: ADD COLUMN بلا IF NOT EXISTS — «${m[0]}»`);
      }
    }
  });

  test("ولا DROP/RENAME في كود التشغيل إطلاقاً (قاعدةُ محمد: إضافيٌّ فقط)", () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const bad of [/ALTER\s+TABLE\s+[^;]*DROP\s+COLUMN/gi, /ALTER\s+TABLE\s+[^;]*RENAME\s+/gi, /\bDROP\s+TABLE\b/gi]) {
        const m = src.match(bad);
        assert.equal(m, null, `${f}: تغييرٌ هدّامٌ في الكود — «${m?.[0]}»`);
      }
    }
  });
});
