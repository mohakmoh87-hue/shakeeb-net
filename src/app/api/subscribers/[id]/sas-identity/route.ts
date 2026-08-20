import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasFetchUser } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { credsOfSubscriber } from "@/lib/sasPanel";

export const dynamic = "force-dynamic";

// ═════ 🛡️ حارسُ «اليوزر المختلف» — هويّةُ رقم الساس (طلب محمد 2026-08-21) ═════
// حالة bg-7-4-2@mu: صفُّ المشترك يحمل sasId يعود ليوزرٍ آخر (bg-7-5-1@mu)، وصفحةُ
// التفعيل تُفتح **بالرقم** فيظهر يوزرٌ غريبٌ ولا شيءَ يعترض — والمالُ كاد يُقيَّد لحساب
// غير صاحبه. نصُّ محمد: «الحارس هو لليوزر تحديداً وليس شيء آخر — كل شيء غير مهم عدا
// اليوزر الثابت». هذا المسارُ يقرأ يوزرَ صاحبِ الرقم من الساس ليقارنَه بيوزرنا:
// النافذةُ تسأله عند الفتح فتحجب سحبَ الكارت والحفظَ حتى صحِّ الإقرار، والخادمُ يعيد
// الفحصَ حكماً في مسار التفعيل نفسِه (فالواجهةُ تُرشد والخادمُ يحرس).
// تعذُّرُ القراءة (ساسٌ مطفأ/مضيفٌ محجوب) ⇒ checked:false — لا نحجب تفعيلاتِ مكتبٍ
// كاملٍ لعطلِ اتّصالٍ عابر؛ الحجبُ للاختلاف المُثبَت حصراً.

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;
  const { id } = await params;
  const sub = await prisma.subscriber.findUnique({
    where: { id: Number(id) },
    select: { id: true, netUser: true, sasId: true, towerId: true, isDeleted: true },
  });
  if (!sub || sub.isDeleted) return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  if (!(await ownsTower(g.session, sub.towerId))) return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });

  // بلا ربطِ ساسٍ أو بلا يوزرٍ عندنا ⇒ لا شيءَ يُقارَن (التفعيلُ اليدويُّ حرّ)
  if (!sub.sasId || !norm(sub.netUser)) return NextResponse.json({ checked: false, match: true });

  try {
    const creds = await credsOfSubscriber(sub.id);
    if (!creds || (await sasHostBlocked(creds.loginUrl))) return NextResponse.json({ checked: false, match: true });
    const base = sasBaseUrl(creds.loginUrl);
    const token = await sasLogin(base, creds.username, creds.password);
    const info = await sasFetchUser(base, token, sub.sasId);
    if (!info?.username) return NextResponse.json({ checked: false, match: true });
    const match = norm(info.username) === norm(sub.netUser);
    return NextResponse.json({ checked: true, match, ourUser: sub.netUser, sasUser: info.username });
  } catch {
    return NextResponse.json({ checked: false, match: true });
  }
}
