// هجرة: عمود reminderTime على towers (إضافي، nullable، آمن) —
// وقت تذكير الانتهاء الخاص بكل مكتب (فارغ = وقت الوكيل العام كما كان)
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const sql = neon(url);

await sql`ALTER TABLE towers ADD COLUMN IF NOT EXISTS "reminderTime" text`;
const [{ exists }] = await sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='towers' AND column_name='reminderTime'
  ) AS exists`;
console.log("towers.reminderTime exists:", exists);
