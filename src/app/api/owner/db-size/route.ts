import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// حد خطة القاعدة (ميغابايت) — للمؤشّر فقط. يُضبط من البيئة حسب المزود:
// Neon المجاني 500 (الافتراضي — الإنتاج الحالي)، Aiven المجاني 1000.
const LIMIT_MB = Number(process.env.DB_SIZE_LIMIT_MB) || 500;

// هوية القاعدة الفعلية (مضيف واسم فقط — بلا بيانات اعتماد) ليعرف المالك أي قاعدة يخدم الموقع
function dbIdentity(): { dbHost: string; dbName: string } {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return { dbHost: u.hostname, dbName: u.pathname.replace(/^\//, "") };
  } catch {
    return { dbHost: "غير معروف", dbName: "" };
  }
}

// مؤشّر حجم قاعدة البيانات (للمالك): الحجم الكلي + أكبر الجداول + نسبة الامتلاء
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;

  const [[db], tables] = await Promise.all([
    prisma.$queryRawUnsafe<{ bytes: bigint }[]>(
      `SELECT pg_database_size(current_database()) AS bytes`,
    ),
    prisma.$queryRawUnsafe<{ tbl: string; total: bigint; rows: bigint }[]>(
      `SELECT s.relname::text AS tbl, pg_total_relation_size(s.relid) AS total, s.n_live_tup AS rows
       FROM pg_stat_user_tables s
       ORDER BY pg_total_relation_size(s.relid) DESC LIMIT 8`,
    ),
  ]);

  const usedMB = Number(db?.bytes ?? 0) / 1024 / 1024;
  const percent = Math.round((usedMB / LIMIT_MB) * 1000) / 10;

  return NextResponse.json({
    ...dbIdentity(),
    usedMB: Math.round(usedMB * 10) / 10,
    limitMB: LIMIT_MB,
    percent,
    level: percent >= 80 ? "danger" : percent >= 60 ? "warn" : "ok",
    topTables: tables.map((t) => ({ table: t.tbl, mb: Math.round((Number(t.total) / 1024 / 1024) * 100) / 100, rows: Number(t.rows) })),
  });
}
