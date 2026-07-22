import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// محرّك Neon السحابي (WebSocket): يُلغي زمن فتح اتصال TCP في كل استدعاء serverless،
// فأسرع بكثير على Vercel، مع دعم المعاملات التفاعلية ($transaction) عبر Pool.
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// اختيار السائق تلقائياً من مضيف الرابط: neon.tech ← سائق Neon (إنتاج فرسل الحالي
// وحواسيب المكاتب كما هي)، وأي مضيف آخر ← السائق القياسي pg (Aiven وغيرها) — فيكفي
// تبديل DATABASE_URL وحده (موقعاً وحواسيب) دون متغيرات إضافية. DB_DRIVER يبقى تجاوزاً صريحاً.
function createAdapter() {
  const driver =
    process.env.DB_DRIVER ??
    (/\.neon\.tech/i.test(process.env.DATABASE_URL ?? "") ? "neon" : "pg");
  if (driver === "pg") {
    // DB_SSL_CA_B64 (اختياري): شهادة CA بصيغة base64 — قواعد مثل Aiven توقّع شهادة
    // خادمها بمرجع خاص بالمشروع، فنمرّرها صراحةً ليبقى التحقق الكامل من TLS قائماً.
    // ملاحظة إلزامية: sslmode داخل الرابط يطغى على إعداد ssl الصريح في مكتبة pg،
    // فنحذفه من الرابط عند تمرير الشهادة — وإلا فُحصت الشهادة بمخازن النظام وفشلت.
    const caB64 = process.env.DB_SSL_CA_B64;
    if (caB64) {
      const cs = new URL(process.env.DATABASE_URL ?? "");
      cs.searchParams.delete("sslmode");
      return new PrismaPg({
        connectionString: cs.toString(),
        ssl: { ca: Buffer.from(caB64, "base64").toString("utf8"), rejectUnauthorized: true },
      });
    }
    return new PrismaPg({ connectionString: process.env.DATABASE_URL });
  }
  return new PrismaNeon({ connectionString: process.env.DATABASE_URL });
}

function createClient() {
  return new PrismaClient({
    adapter: createAdapter(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
