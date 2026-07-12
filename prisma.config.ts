import "dotenv/config";
import { defineConfig } from "prisma/config";

// إعداد Prisma 7 - رابط قاعدة البيانات لأوامر migrate/introspect.
// نقرأ DATABASE_URL من البيئة مباشرةً مع بديل غير فعّال عند غيابه، حتى لا يفشل
// `prisma generate` (لا يتّصل بقاعدة البيانات) في بيئات لا يُضبَط فيها المتغيّر —
// مثل نشر المعاينة (Preview) على Vercel. أوامر migrate/introspect تظلّ تحتاج
// DATABASE_URL الحقيقي المضبوط في بيئة الإنتاج.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
