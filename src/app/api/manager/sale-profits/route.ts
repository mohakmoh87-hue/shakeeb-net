import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { monthRange, monthLabel, rangeWarning, baghdadParts } from "@/lib/profits";
import { computeSaleProfits, getSalePeriod, startNewSaleMonth, getSaleView, saveSaleView } from "@/lib/saleProfits";

export const dynamic = "force-dynamic";

// ═════ 🏷️ أرباحُ المبيع — قراءةٌ وحساب. بصلاحيّة حسابات المدير وعزلِ المكاتب، بلا أثرٍ ماليّ.
//   شهريّةٌ بآليّةِ «أرباح الشركة» (بدء شهر جديد) لكن **بلا قصٍّ على التأسيس** — البحثُ بين
//   تاريخين يرى أيَّ فترةٍ ماضية (بأثرٍ رجعيّ، طلبُ محمد).

async function resolveRange(agentId: number, sp: URLSearchParams) {
  const month = (sp.get("month") ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const r = monthRange(y, m - 1);
    return { ...r, label: monthLabel(r.from), warning: null as string | null, mode: "month" as const };
  }
  const fromTxt = sp.get("from"), toTxt = sp.get("to");
  if (fromTxt && toTxt) {
    const from = new Date(`${fromTxt}T00:00:00+03:00`);
    const to = new Date(`${toTxt}T23:59:59.999+03:00`);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && to >= from) {
      return { from, to, label: monthLabel(from), warning: rangeWarning(from, to), mode: "custom" as const };
    }
  }
  const p = await getSalePeriod(agentId);
  return { from: p.from, to: p.to, label: p.label, warning: null as string | null, mode: "current" as const };
}

export async function GET(req: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const towers = await agentTowerIds(g.session ?? null);
  const sp = new URL(req.url).searchParams;
  const askTower = Number(sp.get("tower")) || 0;
  const scope = askTower && towers.includes(askTower) ? [askTower] : towers;

  const range = await resolveRange(agentId, sp);
  const period = await getSalePeriod(agentId);
  const report = await computeSaleProfits(agentId, scope, range.from, range.to); // بلا قصٍّ على التأسيس (رجعيّ)
  const bp = baghdadParts(range.from);
  const view = await getSaleView(g.session?.userId ?? -1);
  const offices = (await prisma.tower.findMany({ where: { id: { in: towers }, isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" } }))
    .map((t) => ({ id: t.id, name: t.name ?? String(t.id) }));
  return NextResponse.json({
    view,
    ...report,
    offices,
    from: range.from.toISOString(), to: range.to.toISOString(),
    label: range.label, warning: range.warning, mode: range.mode,
    monthValue: `${bp.y}-${String(bp.m + 1).padStart(2, "0")}`,
    tower: askTower && towers.includes(askTower) ? askTower : 0,
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label, ended: period.ended, epoch: period.epoch.toISOString() },
  });
}

export async function PUT(req: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const uid = g.session?.userId ?? -1;
  const b = await req.json().catch(() => ({}));
  await saveSaleView(uid, { mode: b?.mode, month: b?.month, from: b?.from, to: b?.to, tower: b?.tower });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const b = await req.json().catch(() => ({}));
  if (b?.action === "newMonth") {
    const p = await startNewSaleMonth(agentId);
    return NextResponse.json({ ok: true, period: { from: p.from.toISOString(), to: p.to.toISOString(), label: p.label, ended: p.ended } });
  }
  return NextResponse.json({ error: "إجراءٌ غير معروف" }, { status: 400 });
}
