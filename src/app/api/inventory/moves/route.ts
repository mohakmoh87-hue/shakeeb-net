import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { readInventoryMoves, MOVE_LABEL, type MoveKind } from "@/app/api/_lib/inventoryMoveLog";

export const dynamic = "force-dynamic";

const KINDS = Object.keys(MOVE_LABEL) as MoveKind[];

const num = (v: string | null) => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const day = (v: string | null, end: boolean) => {
  if (!v) return null;
  // حدودُ اليوم بتوقيت بغداد — فاللحظاتُ مخزَّنةٌ UTC، ويومُ المستخدم يبدأ قبلها بثلاث ساعات
  const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ═════ 🔁🧰 سجلُّ الترحيلات والذمم — قراءةٌ موحَّدةٌ بأثرٍ رجعيّ ═════
export async function GET(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = g.session;
  const agentId = session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });

  // 🔒 نطاقُ المكاتب كبقيّة المخزن: مستخدمُ المكتب مكتبَه وحدَه، والمديرُ مكاتبَ وكيله
  const all = await agentTowerIds(session);
  const offices = session && !session.isAdmin && session.towerId != null
    ? (all.includes(session.towerId) ? [session.towerId] : [])
    : all;

  const sp = new URL(request.url).searchParams;
  const asked = (sp.get("kinds") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as MoveKind[];
  const kinds = asked.filter((k) => KINDS.includes(k));
  const reqOffice = num(sp.get("officeId"));

  const { rows, truncated } = await readInventoryMoves({
    offices, agentId,
    from: day(sp.get("from"), false),
    to: day(sp.get("to"), true),
    officeId: reqOffice != null && offices.includes(reqOffice) ? reqOffice : null,
    techId: num(sp.get("techId")),
    itemId: num(sp.get("itemId")),
    kinds: kinds.length ? kinds : null,
    q: sp.get("q"),
    minPrice: num(sp.get("minPrice")),
    maxPrice: num(sp.get("maxPrice")),
    minQty: num(sp.get("minQty")),
    maxQty: num(sp.get("maxQty")),
    showCost: !!session?.isAdmin,
    take: Math.min(Math.max(num(sp.get("take")) ?? 500, 1), 2000),
  });

  const [towers, techs] = await Promise.all([
    prisma.tower.findMany({ where: { id: { in: offices.length ? offices : [-1] }, isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.technician.findMany({ where: { towerId: { in: offices.length ? offices : [-1] }, isDeleted: false }, select: { id: true, name: true, towerId: true }, orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({
    rows, truncated, showCost: !!session?.isAdmin,
    offices: towers.map((t) => ({ id: t.id, name: t.name ?? `#${t.id}` })),
    technicians: techs,
    labels: MOVE_LABEL,
  });
}
