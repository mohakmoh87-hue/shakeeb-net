// هجرة: إضافة عمود fcmToken لجدول technicians على Neon (إضافي، nullable، آمن).
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const sql = neon(url);

await sql`ALTER TABLE technicians ADD COLUMN IF NOT EXISTS "fcmToken" text`;
const [{ exists }] = await sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='technicians' AND column_name='fcmToken'
  ) AS exists`;
console.log("fcmToken column exists:", exists);
