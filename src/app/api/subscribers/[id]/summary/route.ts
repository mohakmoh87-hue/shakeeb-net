import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { getEffectiveTemplate } from "@/lib/smsTemplates";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// إرسال «وصل ملخص الاشتراك» واتساب للمشترك بضغطة واحدة (زر «ارسال ملخص» في صفحة
// المشتركين). النص من قالب «ملخص الاشتراك» القابل للتخصيص في قوالب الرسائل.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const subscriber = await prisma.subscriber.findUnique({ where: { id: Number(id) } });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  if (!subscriber.phone) return NextResponse.json({ error: "لا يوجد رقم هاتف للمشترك" }, { status: 400 });
  if (subscriber.waEnabled === false) return NextResponse.json({ error: "واتساب معطَّل لهذا المشترك" }, { status: 400 });

  // مكتب المشترك: الاسم + تفعيل الواتساب + وكيله (لقالب وكيله حصراً — عزل)
  const office = subscriber.towerId
    ? await prisma.tower.findUnique({ where: { id: subscriber.towerId }, select: { name: true, waEnabled: true, agentId: true } })
    : null;
  if (office?.waEnabled === "0") return NextResponse.json({ error: "واتساب المكتب معطَّل" }, { status: 400 });

  const tpl = await getEffectiveTemplate("subSummary", office?.agentId ?? session?.agentId ?? null);
  if (!tpl) return NextResponse.json({ error: "قالب «ملخص الاشتراك» معطَّل — فعّله من قوالب الرسائل" }, { status: 400 });

  const pkg = subscriber.packageId
    ? await prisma.package.findUnique({ where: { id: subscriber.packageId }, select: { name: true, priceDinar: true } })
    : null;

  const text = renderTemplate(tpl, {
    name: subscriber.name,
    netUser: subscriber.netUser,
    package: pkg?.name ?? "",
    price: pkg?.priceDinar ?? 0,
    carry: subscriber.carry ?? 0,
    remaining: subscriber.carry ?? 0,
    dateTo: subscriber.dateTo ? formatDate(subscriber.dateTo) : "",
    phone: subscriber.phone,
    code: subscriber.rewardCode, balance: subscriber.rewardBalance ?? 0, // كود/رصيد الخصم
    office: office?.name ?? "SHAKEEB",
  });

  const res = await sendViaProvider("WHATSAPP", subscriber.phone, text, subscriber.towerId);
  await prisma.message.create({
    data: {
      channel: "WHATSAPP", subscriberId: subscriber.id, phone: subscriber.phone, text,
      status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
      createdByUser: session?.username,
    },
  });
  if (!res.ok) return NextResponse.json({ error: res.error ?? "تعذّر الإرسال" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
