import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// حالة اتصال واتساب مكتب محدّد + رمز QR للربط (?officeId=)
// على الوكيل المحلي (RUN_WORKER=1): يشغّل واتساب محلياً ويقرأ الحالة مباشرةً.
// على الموقع (Vercel، بلا متصفّح): يطلب الاتصال من الوكيل ويقرأ الحالة/الـQR من السحابة.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  if (!session.isAdmin && session.towerId !== officeId) {
    return NextResponse.json({ error: "لا يمكنك ربط واتساب مكتب آخر" }, { status: 403 });
  }

  const toImg = (qr: string | null | undefined) =>
    qr ? QRCode.toDataURL(qr, { margin: 1, width: 320 }).catch(() => null) : Promise.resolve(null);

  // الوكيل المحلي: تشغيل واتساب مباشرةً (Chromium متاح هنا)
  if (process.env.RUN_WORKER === "1") {
    const { startWhatsApp, whatsappStatus } = await import("@/lib/whatsapp");
    await startWhatsApp(officeId);
    const st = whatsappStatus(officeId);
    return NextResponse.json({ state: st.state, qrImage: await toImg(st.qr), error: st.error });
  }

  // الموقع: سجّل طلب اتصال ليلتقطه الوكيل، واقرأ آخر حالة/QR نشرها الوكيل في السحابة
  await prisma.waSession.upsert({
    where: { towerId: officeId },
    update: { requestedAt: new Date() },
    create: { towerId: officeId, requestedAt: new Date(), state: "starting" },
  });
  const sess = await prisma.waSession.findUnique({ where: { towerId: officeId } });
  return NextResponse.json({
    state: sess?.state ?? "starting",
    qrImage: await toImg(sess?.qr),
    error: sess?.error ?? null,
  });
}
