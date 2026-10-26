import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberState } from "@/lib/subscriberLogin";
import { subscriberOnline } from "@/lib/subscriberOnline";

export const dynamic = "force-dynamic";

// 🔌 حالةُ اتّصال المشترك لشاشته الرئيسيّة (طلبُ محمد 2026-10-26) — ثلاثُ حالاتٍ لا غير:
//   expired = اشتراكُه منتهٍ · online = فعّالٌ ومتّصل · offline = فعّالٌ وغيرُ متّصل.
// 🔒 صاحبُ الجلسة وحدَه، ولا يُقبَل مشتركٌ من الطلب. ومسارٌ مستقلٌّ عن `/api/app/me`
//    كي لا يُبطئ فتحَ التطبيق بانتظار الساس — الواجهةُ تطلبه بعد أن ترسم.
export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { dateTo: true, appBanned: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });

  const st = subscriberState(sub.dateTo);
  if (st.state !== "active") return NextResponse.json({ status: "expired", daysExpired: st.daysExpired });

  // null = تعذّر التحقّق (لوحةٌ متعذّرةٌ أو بحثٌ غيرُ حاسم) ⇒ يُعرَض «غير متصل»
  const online = await subscriberOnline(sess.subscriberId);
  return NextResponse.json({ status: online === true ? "online" : "offline", checked: online !== null });
}
