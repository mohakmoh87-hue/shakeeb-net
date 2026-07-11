import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// إعداد Prisma 7 - رابط قاعدة البيانات لأوامر migrate/introspect
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
