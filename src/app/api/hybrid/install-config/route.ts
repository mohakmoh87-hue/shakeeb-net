import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureAgentRoleUrl } from "@/lib/agentDbRole";

export const dynamic = "force-dynamic";

// يُسلّم إعدادات التنصيب (رابط قاعدة البيانات) مقابل رمز صالح لمرّة واحدة.
// عام لكن محميّ بالرمز — لا يُكشف الرابط في أي سكربت عام.
// عزل RLS: يُسلَّم حصراً رابط «دور الوكيل» صاحب الرمز (لا الرابط الرئيسي أبداً)،
// فلا ترى حاسبة المكتب إلا بيانات وكيلها حتى بـSQL خام.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "رمز مطلوب" }, { status: 400 });

  const row = await prisma.installToken.findUnique({ where: { token } });
  if (!row) return NextResponse.json({ error: "رمز غير صالح" }, { status: 403 });
  if (row.usedAt) return NextResponse.json({ error: "الرمز مُستخدَم مسبقاً — أنشئ رمزاً جديداً" }, { status: 403 });
  if (row.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "انتهت صلاحية الرمز — أنشئ رمزاً جديداً" }, { status: 403 });
  if (row.agentId == null) return NextResponse.json({ error: "الرمز غير مرتبط بوكيل" }, { status: 403 });

  // رابط دور الوكيل (يُنشأ إن لم يوجد بعد) — معزول بـRLS
  const databaseUrl = await ensureAgentRoleUrl(row.agentId);
  // لا يُسلَّم رابطٌ غير مشفَّر لحاسبةٍ جديدة (تدقيق 2026-08-10) — ولا يُستهلَك الرمز حينها
  const { workerUrlIsEncrypted } = await import("@/lib/agentDbRole");
  if (!workerUrlIsEncrypted(databaseUrl)) {
    console.error(`[install-config] رابط الوكيل ${row.agentId} بلا تشفير — لم يُسلَّم`);
    return NextResponse.json(
      { error: 'رابط القاعدة المخزَّن بلا تشفير — أضِف sslmode إلى agents."workerDbUrl"' },
      { status: 500 },
    );
  }

  // لمرّة واحدة: علّمه مستخدَماً بعد نجاح تجهيز الرابط
  await prisma.installToken.update({ where: { token }, data: { usedAt: new Date() } });

  // شهادة CA للقاعدة (إن كانت مضبوطة — قواعد مثل Aiven): تُسلَّم للحاسبة لتوثيق TLS كاملاً
  return NextResponse.json({ databaseUrl, agentId: row.agentId, caB64: process.env.DB_SSL_CA_B64 ?? null });
}
