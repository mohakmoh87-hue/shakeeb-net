import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// محرّك Neon السحابي (WebSocket): يُلغي زمن فتح اتصال TCP في كل استدعاء serverless،
// فأسرع بكثير على Vercel، مع دعم المعاملات التفاعلية ($transaction) عبر Pool.
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// اختيار السائق عبر البيئة: الافتراضي Neon (إنتاج فرسل الحالي وحواسيب المكاتب كما هي)،
// وعند DB_DRIVER=pg يعمل سائق PostgreSQL القياسي (node-postgres) لأي استضافة وقاعدة
// قياسيتين مثل Cloud Run + Aiven — نفس الشيفرة على البيئتين بلا فرعين.
function createAdapter() {
  if (process.env.DB_DRIVER === "pg") {
    // DB_SSL_CA_B64 (اختياري): شهادة CA بصيغة base64 — قواعد مثل Aiven توقّع شهادة
    // خادمها بمرجع خاص بالمشروع، فنمرّرها صراحةً ليبقى التحقق الكامل من TLS قائماً.
    const caB64 = process.env.DB_SSL_CA_B64;
    return new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      ...(caB64
        ? { ssl: { ca: Buffer.from(caB64, "base64").toString("utf8"), rejectUnauthorized: true } }
        : {}),
    });
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
