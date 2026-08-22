import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { cabinetOfUser } from "@/lib/profits";

export const dynamic = "force-dynamic";

// ═════ ⚙️ قواعدُ ربح الشركة — قراءةٌ وحفظ (طلبُ محمد 2026-08-22) ═════
// ثلاثُ طبقاتٍ ترث: **الكابينة ← المكتب ← العامّ** — فقاعدةٌ واحدةٌ تكفي، والاستثناءُ سطر.
// 🔒 بصلاحيّة `manager.accounts` وبعزلٍ صارم: `agentId` من الجلسة دائماً، والمكتبُ يجب
//    أن يتبع مكاتبَ الوكيل، ورقمُ الكابينة يجب أن يكون **من كابينات ذلك المكتب فعلاً**.
// ✋ ولا أثرَ ماليّ: هذه إعداداتُ عرضٍ لا قيود.
const tableMissing = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";

const KINDS = ["act", "instIn", "instExt", "deduct"] as const;

const schema = z.object({
  towerId: z.coerce.number().int().min(0).default(0),   // 0 = عامّ لكلّ المكاتب
  cabinets: z.array(z.coerce.number().int().min(0)).default([0]), // [0] = كلُّ كابينات النطاق
  act: z.object({
    mode: z.enum(["percent", "fixed"]),
    percent: z.coerce.number().min(0).max(100).default(0),
    perPackage: z.record(z.string(), z.coerce.number().int().min(0)).default({}),
  }).optional(),
  instIn: z.record(z.string(), z.coerce.number().int().min(0)).optional(),
  instExt: z.record(z.string(), z.coerce.number().int().min(0)).optional(),
  deduct: z.record(z.string(), z.coerce.number().int().min(0)).optional(),
  /** حذفُ قواعدِ هذا النطاق (يعود للوراثة من أعلى) */
  reset: z.boolean().optional(),
});

/** كابيناتُ كلّ مكتب — تُشتقّ من يوزرات المشتركين (`bg-47-…` ⇒ FDT47) */
async function cabinetsByTower(towerIds: number[]): Promise<Record<number, number[]>> {
  const subs = await prisma.subscriber.findMany({
    where: { towerId: { in: towerIds }, isDeleted: false, netUser: { not: null } },
    select: { towerId: true, netUser: true },
  });
  const map: Record<number, Set<number>> = {};
  for (const s of subs) {
    const c = cabinetOfUser(s.netUser);
    if (!c || s.towerId == null) continue;
    (map[s.towerId] = map[s.towerId] ?? new Set<number>()).add(c);
  }
  const out: Record<number, number[]> = {};
  for (const t of towerIds) out[t] = [...(map[t] ?? new Set<number>())].sort((a, b) => a - b);
  return out;
}

export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const towers = await agentTowerIds(g.session ?? null);

  const [towerRows, packages, cabs] = await Promise.all([
    prisma.tower.findMany({ where: { id: { in: towers } }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.package.findMany({ where: { agentId, isDeleted: false }, select: { id: true, name: true, priceDinar: true }, orderBy: [{ name: "asc" }] }),
    cabinetsByTower(towers),
  ]);
  try {
    const rules = await prisma.profitRule.findMany({
      where: { agentId },
      select: { towerId: true, cabinet: true, kind: true, packageId: true, mode: true, percent: true, amount: true },
      orderBy: [{ towerId: "asc" }, { cabinet: "asc" }],
    });
    return NextResponse.json({ towers: towerRows, packages, cabinets: cabs, rules, dormant: false });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ towers: towerRows, packages, cabinets: cabs, rules: [], dormant: true });
    throw e;
  }
}

export async function POST(req: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const towers = await agentTowerIds(g.session ?? null);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const d = parsed.data;
  if (d.towerId !== 0 && !towers.includes(d.towerId)) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }
  // 🔒 الكابينةُ يجب أن تكون من كابينات ذلك المكتب فعلاً (لا رقمَ من الهواء)
  const cabs = await cabinetsByTower(d.towerId ? [d.towerId] : towers);
  const known = new Set<number>([0, ...Object.values(cabs).flat()]);
  const cabinets = [...new Set(d.cabinets)].filter((c) => known.has(c));
  if (!cabinets.length) return NextResponse.json({ error: "لا كابيناتٍ صالحة" }, { status: 400 });

  const pkgIds = new Set((await prisma.package.findMany({
    where: { agentId, isDeleted: false }, select: { id: true },
  })).map((p) => p.id));

  const writes: { kind: string; packageId: number; mode?: string | null; percent?: number | null; amount?: number | null }[] = [];
  if (d.act) {
    writes.push({ kind: "act", packageId: 0, mode: d.act.mode, percent: d.act.mode === "percent" ? d.act.percent : null });
    if (d.act.mode === "fixed") {
      for (const [pid, amt] of Object.entries(d.act.perPackage)) {
        if (pkgIds.has(Number(pid))) writes.push({ kind: "act", packageId: Number(pid), amount: Math.round(amt) });
      }
    }
  }
  for (const kind of ["instIn", "instExt", "deduct"] as const) {
    const m = d[kind];
    if (!m) continue;
    for (const [pid, amt] of Object.entries(m)) {
      if (pkgIds.has(Number(pid))) writes.push({ kind, packageId: Number(pid), amount: Math.round(amt) });
    }
  }

  try {
    for (const cabinet of cabinets) {
      if (d.reset) {
        await prisma.profitRule.deleteMany({ where: { agentId, towerId: d.towerId, cabinet } });
        continue;
      }
      for (const w of writes) {
        const key = { agentId, towerId: d.towerId, cabinet, kind: w.kind, packageId: w.packageId };
        const existing = await prisma.profitRule.findFirst({ where: key, select: { id: true } });
        const data = { mode: w.mode ?? null, percent: w.percent ?? null, amount: w.amount ?? null };
        if (existing) await prisma.profitRule.update({ where: { id: existing.id }, data });
        else await prisma.profitRule.create({ data: { ...key, ...data } });
      }
      // نمطُ النسبة يُلغي المبالغَ الثابتةَ لنفس النطاق (وبالعكس) — فلا تتعارض قاعدتان
      if (d.act?.mode === "percent") {
        await prisma.profitRule.deleteMany({ where: { agentId, towerId: d.towerId, cabinet, kind: "act", packageId: { gt: 0 } } });
      }
    }
    return NextResponse.json({ ok: true, saved: cabinets.length });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ error: "جدولُ قواعد الربح غيرُ مُهيَّأ بعد — الصقِ السطرَ الجاهز في القاعدة" }, { status: 503 });
    throw e;
  }
}
