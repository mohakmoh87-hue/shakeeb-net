import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureAgentRoleUrl, acceptedUrlHashes, hashUrl } from "@/lib/agentDbRole";

export const dynamic = "force-dynamic";

// ===== الربط الذاتي لحاسبات المكاتب (2026-08-02) =====
// الحاسبة تسأل هنا عن إعدادات اتصالها بالقاعدة، فتتبدّل القاعدة (نقل/تدوير مفتاح) بلا
// زيارة أي مكتب. لا رمز تنصيب ولا سرّ مزروع باليد: الحاسبة تُثبت هويتها ببرهان أنها
// تحمل رابطاً صالحاً لوكيلها (الحالي أو أحد الخمسة السابقة) — بصمة sha256 لا الرابط نفسه.
//
// الأمان: يلزم معرّف الحاسبة المسجَّل + برهان الرابط معاً؛ ومن يملك الرابط القديم يملك
// وصولاً لبيانات ذلك الوكيل أصلاً فلا تصعيد. والحاسبة المحظورة (blocked) لا تُخدَم أبداً
// — فزرّ «حذف الحاسبة» عند المدير يصير قاطعاً فعلياً حتى لو سُرق الجهاز.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const machineId = typeof body?.machineId === "string" ? body.machineId.trim() : "";
  const proof = typeof body?.proof === "string" ? body.proof.trim().toLowerCase() : "";
  if (!machineId || !/^[a-f0-9]{64}$/.test(proof)) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const worker = await prisma.hybridWorker.findUnique({
    where: { machineId },
    select: { id: true, agentId: true, approved: true, blocked: true },
  });
  if (!worker || worker.blocked || !worker.approved || worker.agentId == null) {
    return NextResponse.json({ error: "الحاسبة غير معتمدة" }, { status: 403 });
  }

  const accepted = await acceptedUrlHashes(worker.agentId);
  if (!accepted.includes(proof)) {
    return NextResponse.json({ error: "برهان غير مطابق" }, { status: 403 });
  }

  // الرابط الحالي (يُنشأ إن لم يوجد — لا يحدث عملياً بعد التنصيب)
  const databaseUrl = await ensureAgentRoleUrl(worker.agentId);
  await prisma.hybridWorker.update({ where: { id: worker.id }, data: { configAt: new Date() } }).catch(() => {});

  return NextResponse.json({
    databaseUrl,
    caB64: process.env.DB_SSL_CA_B64 ?? null,
    // بصمة الرابط المُعاد: تتحقّق الحاسبة أن ما وصلها سليم قبل اعتماده
    urlHash: hashUrl(databaseUrl),
  });
}
