import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { startWhatsApp, whatsappStatus } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// حالة اتصال واتساب مكتب محدّد + رمز QR للربط (?officeId=)
// ربط الواتساب متاح لأي مستخدم لمكتبه (خارج صلاحية إدارة المكاتب)؛ الأدمن لأي مكتب.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  if (!session.isAdmin && session.towerId !== officeId) {
    return NextResponse.json({ error: "لا يمكنك ربط واتساب مكتب آخر" }, { status: 403 });
  }

  await startWhatsApp(officeId);
  const st = whatsappStatus(officeId);
  let qrImage: string | null = null;
  if (st.qr) qrImage = await QRCode.toDataURL(st.qr, { margin: 1, width: 320 }).catch(() => null);
  return NextResponse.json({ state: st.state, qrImage, error: st.error });
}
