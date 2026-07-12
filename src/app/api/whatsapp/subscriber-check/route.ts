import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { hasWhatsApp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// فحص واتساب المشترك — للتنبيه فقط عند فتح المشترك من القائمة.
// الحالات:
//   no-phone     : لا يملك المشترك رقم هاتف       → تنبيه
//   no-whatsapp  : له رقم لكن لا واتساب عليه       → تنبيه
//   ok           : له رقم وعليه واتساب             → لا تنبيه
//   unknown      : تعذّر الفحص (واتساب المكتب غير متصل) → لا تنبيه
// لا يؤثر هذا الفحص على أي عملية أخرى — تنبيه بحت.
export async function GET(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const id = Number(new URL(request.url).searchParams.get("subscriberId"));
  if (!id) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });

  const sub = await prisma.subscriber.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, phone: true, towerId: true },
  });
  if (!sub || !ownsTower(g.session, sub.towerId)) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }

  const phone = (sub.phone ?? "").trim();
  if (!phone) return NextResponse.json({ status: "no-phone" });

  const has = await hasWhatsApp(sub.towerId, phone);
  if (has === null) return NextResponse.json({ status: "unknown" });
  return NextResponse.json({ status: has ? "ok" : "no-whatsapp" });
}
