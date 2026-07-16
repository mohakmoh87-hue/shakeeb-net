import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// فصل واتساب مكتب محدّد.
// الموقع (Vercel) لا يملك عميل واتساب — لذا نكتب الفصل في السحابة (state=disconnected،
// نمسح الـQR ونُلغي طلب الاتصال)، فيلتقطه الوكيل ويُنفّذ الفصل الحقيقي ويحذف الجلسة.
// إن كان هذا هو الوكيل نفسه (RUN_WORKER) ننفّذ الفصل محلياً فوراً أيضاً.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const officeId = Number(body?.officeId);
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  if (!session.isAdmin && session.towerId !== officeId) {
    return NextResponse.json({ error: "لا يمكنك فصل واتساب مكتب آخر" }, { status: 403 });
  }

  // إشارة الفصل في السحابة (يلتقطها الوكيل، وتُحدّث الواجهة فوراً)
  await prisma.waSession.upsert({
    where: { towerId: officeId },
    update: { state: "disconnected", qr: null, error: null, requestedAt: null },
    create: { towerId: officeId, state: "disconnected" },
  });

  // على الوكيل المحلي: نفّذ الفصل الحقيقي فوراً (هدم العميل + حذف الجلسة)
  if (process.env.RUN_WORKER === "1") {
    const { logoutWhatsApp } = await import("@/lib/whatsapp");
    await logoutWhatsApp(officeId);
  }
  return NextResponse.json({ ok: true });
}
