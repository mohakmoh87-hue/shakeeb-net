import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// يُسلّم إعدادات التنصيب (رابط قاعدة البيانات) مقابل رمز صالح لمرّة واحدة.
// عام لكن محميّ بالرمز — لا يُكشف الرابط في أي سكربت عام.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "رمز مطلوب" }, { status: 400 });

  const row = await prisma.installToken.findUnique({ where: { token } });
  if (!row) return NextResponse.json({ error: "رمز غير صالح" }, { status: 403 });
  if (row.usedAt) return NextResponse.json({ error: "الرمز مُستخدَم مسبقاً — أنشئ رمزاً جديداً" }, { status: 403 });
  if (row.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "انتهت صلاحية الرمز — أنشئ رمزاً جديداً" }, { status: 403 });

  // لمرّة واحدة: علّمه مستخدَماً فوراً
  await prisma.installToken.update({ where: { token }, data: { usedAt: new Date() } });

  const databaseUrl = process.env.DATABASE_URL ?? "";
  return NextResponse.json({ databaseUrl, agentId: row.agentId });
}
