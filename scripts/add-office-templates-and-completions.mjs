// هجرة إضافية آمنة:
// 1) sms_templates.towerId — قوالب مخصّصة لكل مكتب (null = عام للوكيل، كل الصفوف الحالية تبقى عامة)
// 2) جدول card_completions — سجل إنجازات البطاقات الدائم (لعدّ بطاقات الفني بفترة الراتب)
//    + تعبئة أولية من البطاقات المنجزة الموجودة حالياً (بلا تكرار عند إعادة التشغيل)
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const sql = neon(url);

await sql`ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS "towerId" integer`;
console.log("sms_templates.towerId ✓");

await sql`CREATE TABLE IF NOT EXISTS card_completions (
  id serial PRIMARY KEY,
  "cardId" integer NOT NULL,
  "technicianId" integer NOT NULL,
  "agentId" integer,
  "towerId" integer,
  kind text,
  "completedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
await sql`CREATE INDEX IF NOT EXISTS "card_completions_technicianId_completedAt_idx" ON card_completions ("technicianId", "completedAt")`;
console.log("card_completions ✓");

// تعبئة أولية من البطاقات المنجزة الموجودة (الأرشيف يُحذف بعد أسبوع — ما هو موجود الآن فقط)
const inserted = await sql`
  INSERT INTO card_completions ("cardId", "technicianId", "agentId", "towerId", kind, "completedAt")
  SELECT c.id, c."technicianId", t."agentId", b."towerId", c.kind, c."completedAt"
  FROM task_cards c
  JOIN task_lists l ON l.id = c."listId"
  JOIN task_boards b ON b.id = l."boardId"
  LEFT JOIN towers t ON t.id = b."towerId"
  WHERE c.done = true AND c."technicianId" IS NOT NULL AND c."completedAt" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM card_completions x WHERE x."cardId" = c.id)
  RETURNING id`;
console.log(`backfilled completions: ${inserted.length}`);

const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM card_completions`;
console.log(`total card_completions: ${count}`);
