import { NextResponse } from "next/server";
import { runAutoCheckout } from "@/lib/autoCheckout";

export const dynamic = "force-dynamic";

// كرون سحابي (Vercel Cron): بصمة خروج تلقائية للمنسيّين — تعمل على السحابة مستقلّةً تماماً عن
// حواسيب المكاتب (فتُنفَّذ ولو كانت كلها مغلقة ساعة الجدولة). تُغلق كل حضورٍ مفتوحٍ ليومٍ سابق.
// محميّ بـ CRON_SECRET الذي يُضيفه Vercel Cron تلقائياً في ترويسة Authorization.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  const r = await runAutoCheckout();
  return NextResponse.json({ ok: true, closed: r.closed });
}
