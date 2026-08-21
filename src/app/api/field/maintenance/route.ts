import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCardActor, cardOfficeId } from "@/lib/field";

export const dynamic = "force-dynamic";

// ═════ 🧰 سجلُّ صيانات مشترك البطاقة — يُقرأ من داخل البطاقة نفسِها (طلبُ محمد 2026-08-21) ═════
// «في كلّ بطاقةٍ تُرفَع يظهر أسفلَها سجلُّ صيانات هذا المشترك، يضغط عليه الفنيُّ أو المديرُ
//  أو المستخدمُ فتتمدّد البطاقةُ إلى الأسفل وفيها السجلُّ بتفاصيله».
// ولماذا مسارٌ جديدٌ ولم يُستعمل `/api/subscribers/[id]/maintenance`؟ لأنّ ذاك بصلاحيّة
// `subscribers.manage` — والفنيُّ لا يملكها، ولا يعرف رقمَ المشترك أصلاً؛ هو يعرف بطاقتَه.
// 🔒 والعزلُ هو عزلُ البطاقة نفسِه (`resolveCardActor`): الفنيُّ على بطاقته المسندة إليه
//    وضمن وكيله، والمستخدم/المدير على بطاقات مكاتبه — فلا يُفتح سجلُّ مشترك مكتبٍ آخر.
//
// ومصدرُ المشترك: `subscriberId` على البطاقة إن وُجد (بطاقاتُ العمليات)، وإلّا يُطابَق من
// نصّها كما يفعل الإنجازُ حرفيّاً (سطرُ «اليوزر:» ثمّ أيّ كلمةٍ تطابق يوزراً) — فيبقى
// السجلُّ ظاهراً حتى للبطاقات التي رُفعت يدويّاً بلا ربطٍ صريح.
async function matchSubscriber(text: string, towerId: number | null) {
  const userLine = text.match(/اليوزر\s*[:：]\s*([^\n]+)/);
  const explicit = userLine?.[1]?.trim();
  const where = towerId != null ? { towerId } : {};
  if (explicit && explicit !== "—") {
    const s = await prisma.subscriber.findFirst({
      where: { isDeleted: false, netUser: { equals: explicit, mode: "insensitive" }, ...where },
      select: { id: true, name: true, netUser: true },
    });
    if (s) return s;
  }
  const words = [...new Set(text.split(/[\s،,\n]+/).map((w) => w.trim()).filter((w) => w.length >= 3))];
  if (!words.length) return null;
  return prisma.subscriber.findFirst({
    where: { isDeleted: false, netUser: { in: words, mode: "insensitive" }, ...where },
    select: { id: true, name: true, netUser: true },
  });
}

export async function GET(request: Request) {
  const cardId = Number(new URL(request.url).searchParams.get("cardId"));
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });

  const r = await resolveCardActor(cardId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const card = await prisma.taskCard.findFirst({
    where: { id: cardId, isDeleted: false },
    select: { id: true, title: true, description: true, subscriberId: true },
  });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });

  const towerId = await cardOfficeId(cardId);
  let sub = card.subscriberId
    ? await prisma.subscriber.findFirst({
        where: { id: card.subscriberId, isDeleted: false },
        select: { id: true, name: true, netUser: true },
      })
    : null;
  if (!sub) sub = await matchSubscriber(`${card.title}\n${card.description ?? ""}`, towerId).catch(() => null);
  if (!sub) return NextResponse.json({ subscriber: null, logs: [] });

  const logs = await prisma.maintenanceLog.findMany({
    where: { subscriberId: sub.id },
    orderBy: { date: "desc" },
    take: 50,
    select: {
      id: true, date: true, details: true, technicianName: true,
      cardTitle: true, kind: true, durationSec: true, amount: true,
    },
  });
  return NextResponse.json({ subscriber: { name: sub.name, netUser: sub.netUser }, logs });
}
