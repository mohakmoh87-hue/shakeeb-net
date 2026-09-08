import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import {
  extractNetUser, extractFdtFat, candidateColumnNames,
  candidateColumnNamesFromFdtFat, areaFromTowerName, resolveLocationByNames,
} from "@/lib/mapLocation";

export const dynamic = "force-dynamic";

// «خريطةُ الكلّ» لعمود التوصيل: يُرجع الإحداثيّاتِ المحلولةَ لكلّ بطاقاتِ العمود (من خريطة
// التغطية، بنفس منطق زرّ الخريطة المفرد) لبناء مسارٍ متعدّد المحطّات في خرائط جوجل على العميل.
// يُرجع المحلولةَ فقط + عددَ ما تعذّر تحديدُه. عزلٌ صارمٌ بالوكيل: البطاقةُ على لوحةٍ يملكها فقط.
export async function POST(request: Request) {
  const session = await getSession();
  const tech = session ? null : await getTechSession();
  if (!session && !tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const agentId = tech ? tech.agentId : session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ points: [], unresolved: 0 });

  const b = await request.json().catch(() => null);
  const cardIds = Array.isArray(b?.cardIds)
    ? [...new Set(b.cardIds.map(Number).filter((x: number) => Number.isFinite(x) && x > 0))].slice(0, 200)
    : [];
  if (!cardIds.length) return NextResponse.json({ points: [], unresolved: 0 });

  const cards = await prisma.taskCard.findMany({
    where: { id: { in: cardIds as number[] }, isDeleted: false, done: false },
    select: { id: true, title: true, description: true, subscriberId: true, officeId: true, listId: true },
  });
  if (!cards.length) return NextResponse.json({ points: [], unresolved: 0 });

  // عزلٌ صارم: البطاقة → عمود → لوحة → مكتب — ووكيلُ المكتب يجب أن يساوي وكيلَ الفاعل.
  const lists = await prisma.taskList.findMany({ where: { id: { in: [...new Set(cards.map((c) => c.listId))] } }, select: { id: true, boardId: true } });
  const listBoard = new Map(lists.map((l) => [l.id, l.boardId] as const));
  const boards = await prisma.taskBoard.findMany({ where: { id: { in: [...new Set([...listBoard.values()])] } }, select: { id: true, towerId: true } });
  const boardTower = new Map(boards.map((bd) => [bd.id, bd.towerId] as const));

  // كلُّ المكاتب المعنيّة (لوحاتٌ + مكتبُ البطاقة + مكتبُ المشترك) — للعزل وللمنطقة، باستعلامٍ واحد
  const subIds = [...new Set(cards.map((c) => c.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? new Map((await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, netUser: true, towerId: true } })).map((s) => [s.id, s] as const))
    : new Map<number, { id: number; netUser: string | null; towerId: number | null }>();
  const towerIds = [...new Set([
    ...[...boardTower.values()].filter((x): x is number => x != null),
    ...cards.map((c) => c.officeId).filter((x): x is number => x != null),
    ...[...subs.values()].map((s) => s.towerId).filter((x): x is number => x != null),
  ])];
  const towers = towerIds.length
    ? new Map((await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, agentId: true, name: true, mapArea: true } })).map((t) => [t.id, t] as const))
    : new Map<number, { id: number; agentId: number | null; name: string | null; mapArea: string | null }>();
  const areaOf = (towerId: number | null | undefined): string | null => {
    if (towerId == null) return null;
    const t = towers.get(towerId);
    if (!t) return null;
    return (t.mapArea && t.mapArea.trim()) ? t.mapArea.trim() : areaFromTowerName(t.name);
  };

  const points: { cardId: number; title: string; lat: number; lng: number }[] = [];
  let unresolved = 0;
  for (const c of cards) {
    // عزل: البطاقة → عمود → لوحة → مكتب. (listBoard: listId→boardId · boardTower: boardId→towerId)
    const boardId = listBoard.get(c.listId) ?? null;
    const boardTowerId = boardId != null ? (boardTower.get(boardId) ?? null) : null;
    if (boardTowerId == null || towers.get(boardTowerId)?.agentId !== agentId) { continue; }

    const sub = c.subscriberId != null ? subs.get(c.subscriberId) : null;
    const combined = `${c.title}\n${c.description ?? ""}`;
    let netUser = sub?.netUser ?? null;
    if (!netUser) netUser = extractNetUser(combined);
    const fdtFat = !netUser ? extractFdtFat(combined) : null;
    if (!netUser && !fdtFat) { unresolved++; continue; }
    const areaHint = areaOf(sub?.towerId ?? c.officeId ?? boardTowerId);
    const names = netUser
      ? candidateColumnNames(netUser, areaHint)
      : candidateColumnNamesFromFdtFat(fdtFat!.fdt, fdtFat!.fat, areaHint);
    const loc = await resolveLocationByNames(names);
    if (!loc) { unresolved++; continue; }
    points.push({ cardId: c.id, title: c.title, lat: loc.lat, lng: loc.lng });
  }
  return NextResponse.json({ points, unresolved });
}
