import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;

  const b = await request.json().catch(() => null);
  const tierId = Number(b?.tierId);
  const text = typeof b?.text === "string" ? b.text : "";
  if (!Number.isFinite(tierId)) return NextResponse.json({ error: "اختَر الفئة" }, { status: 400 });
  const tier = await prisma.distributorTier.findFirst({ where: { id: tierId, distributorId, isDeleted: false }, select: { id: true } });
  if (!tier) return NextResponse.json({ error: "الفئةُ غير موجودة" }, { status: 400 });

  const seen = new Set<string>();
  const rows: { distributorId: number; tierId: number; serial: string; number: string; password: string | null }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\t,;|]+|\s{2,}|\s+/).map((x: string) => x.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const serial = parts[0].slice(0, 120);
    if (!serial || seen.has(serial)) continue;
    seen.add(serial);
    rows.push({ distributorId, tierId, serial, number: (parts[1] ?? serial).slice(0, 120), password: parts[2] ? parts[2].slice(0, 120) : null });
    if (rows.length >= 5000) break;
  }
  if (rows.length === 0) return NextResponse.json({ error: "لا أكوادَ صالحة" }, { status: 400 });

  const res = await prisma.distributorCard.createMany({ data: rows, skipDuplicates: true });
  return NextResponse.json({ ok: true, added: res.count, submitted: rows.length, duplicates: rows.length - res.count });
}

export async function GET(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;
  const url = new URL(request.url);
  const tierId = url.searchParams.get("tierId");
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));

  const where: Record<string, unknown> = { distributorId, transferId: null, isDeleted: false };
  if (tierId && Number.isFinite(Number(tierId))) where.tierId = Number(tierId);
  if (q) where.serial = { contains: q, mode: "insensitive" };
  const cards = await prisma.distributorCard.findMany({ where, orderBy: { id: "desc" }, take: limit, select: { id: true, tierId: true, serial: true, number: true, addedAt: true } });
  const total = await prisma.distributorCard.count({ where });
  return NextResponse.json({ cards, total });
}
