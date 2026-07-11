import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const username = "admin";
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log("المستخدم admin موجود مسبقاً - تخطّي البذور.");
    return;
  }
  const password = await bcrypt.hash("admin", 10);
  await prisma.user.create({
    data: {
      fullName: "مدير النظام",
      username,
      password,
      role: "ADMIN",
      isAdmin: true,
      isActive: true,
    },
  });
  console.log("✓ تم إنشاء المستخدم الافتراضي:");
  console.log("  اسم المستخدم: admin");
  console.log("  كلمة السر:   admin");
  console.log("  (غيّرها بعد أول دخول)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
