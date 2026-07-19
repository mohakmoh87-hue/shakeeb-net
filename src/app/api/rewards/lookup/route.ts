import { NextResponse } from "next/server";
import { getSession, getTechSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// يحاول إيجاد مشترك من نصّ البطاقة (يوزر) ضمن مكتب معيّن — لسحب كود المكافأة في الصيانة
async function matchFromText(text: string, towerId: number | null) {
  const userLine = text.match(/اليوزر\s*[:：]\s*([^\n]+)/);
  const explicit = userLine?.[1]?.trim();
  const where = towerId != null ? { towerId } : {};
  if (explicit && explicit !== "—") {
    const s = await prisma.subscriber.findFirst({ where: { isDeleted: false, netUser: { equals: explicit, mode: "insensitive" }, ...where }, select: { id: true } });
    if (s) return s.id;
  }
  const words = [...new Set(text.split(/[\s،,\n]+/).map((w) => w.trim()).filter((w) => w.length >= 3))];
  if (words.length === 0) return null;
  const s = await prisma.subscriber.findFirst({ where: { isDeleted: false, netUser: { in: words, mode: "insensitive" }, ...where }, select: { id: true } });
  return s?.id ?? null;
}

// رصيد مكافأة مشترك — بـ ?subscriberId= أو ?cardId= (يحلّ مشترك بطاقة الصيانة)
export async function GET(request: Request) {
  // الفاعل: مستخدم المكتب/المدير أو الفني (لإنجاز بطاقته) — كلاهما بعزل الوكيل
  const session = await getSession();
  const tech = session ? null : await getTechSession();
  if (!session && !tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const actorAgentId = session ? session.agentId : tech!.agentId;

  const url = new URL(request.url);
  let subscriberId = Number(url.searchParams.get("subscriberId")) || null;
  const cardId = Number(url.searchParams.get("cardId")) || null;

  if (!subscriberId && cardId) {
    const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false }, select: { title: true, description: true, listId: true } });
    if (card) {
      const list = await prisma.taskList.findUnique({ where: { id: card.listId }, select: { boardId: true } });
      const board = list ? await prisma.taskBoard.findUnique({ where: { id: list.boardId }, select: { towerId: true } }) : null;
      subscriberId = await matchFromText(`${card.title}\n${card.description ?? ""}`, board?.towerId ?? null);
    }
  }
  if (!subscriberId) return NextResponse.json({ found: false });

  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { id: true, name: true, netUser: true, towerId: true, rewardBalance: true, rewardCode: true } });
  // عزل الوكيل: المستخدم عبر ownsTower؛ الفني عبر تطابق وكيل مكتب المشترك
  const owned = session
    ? await ownsTower(session, sub?.towerId)
    : sub?.towerId != null && (await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { agentId: true } }))?.agentId === actorAgentId;
  if (!sub || !owned) return NextResponse.json({ found: false });

  const office = sub.towerId ? await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { rewardsEnabled: true } }) : null;
  return NextResponse.json({
    found: true,
    subscriberId: sub.id,
    name: sub.name,
    netUser: sub.netUser,
    balance: sub.rewardBalance ?? 0,
    code: sub.rewardCode,
    rewardsEnabled: office?.rewardsEnabled === "1",
  });
}
