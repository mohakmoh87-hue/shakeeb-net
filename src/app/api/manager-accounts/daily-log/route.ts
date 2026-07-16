import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// اليوم بصيغة YYYY-MM-DD بتوقيت بغداد (UTC+3)
function baghdadDay(d: Date): string {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// مفتاح المكتب في التجميع: معرّف البرج، و 0 للحركات غير المرتبطة بمكتب
const NO_OFFICE = 0;

type OfficeAgg = { moneyIn: number; moneyOut: number; count: number };
function emptyAgg(): OfficeAgg {
  return { moneyIn: 0, moneyOut: 0, count: 0 };
}

// سجل "مجموع المبالغ اليومية": كل حركات الصندوق مجمّعة حسب اليوم (بتوقيت بغداد).
// يمثّل ما يُضاف للمجموع كل يوم عند التقرير اليومي — كل سطر بتاريخه وصافي مبلغه.
// مجموع صافي كل الأيام = مجموع المبالغ اليومية المعروض في البطاقة.
// إضافةً للإجمالي، نُرجع تفصيل كل يوم حسب المكتب (البرج) ليتمكن المدير من عرض
// التقرير اليومي لكل مكتب على حِدة — دون أي تأثير على طريقة حساب المبالغ نفسها.
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  // عزل المستأجر: مكاتب وكيل المستخدم فقط
  const agentTowers = await agentTowerIds(g.session);
  const [txs, towers] = await Promise.all([
    prisma.moneyTx.findMany({
      // باستثناء حساب الماستر (مستقل عن التقرير اليومي)
      where: { isDeleted: false, towerId: { in: agentTowers }, OR: [{ sourceType: null }, { sourceType: { not: "master" } }] },
      select: { moneyIn: true, moneyOut: true, date: true, towerId: true },
      orderBy: { date: "asc" },
    }),
    prisma.tower.findMany({
      where: { isDeleted: false, id: { in: agentTowers } },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    }),
  ]);

  // اسم كل مكتب حسب معرّفه
  const towerName = new Map<number, string>();
  for (const t of towers) towerName.set(t.id, t.name ?? `مكتب ${t.id}`);

  // تجميع: يوم → (إجمالي + تفصيل حسب المكتب)
  const map = new Map<
    string,
    { day: string; total: OfficeAgg; byOffice: Map<number, OfficeAgg> }
  >();
  const usedOffices = new Set<number>();

  for (const t of txs) {
    if (!t.date) continue;
    const day = baghdadDay(t.date);
    const officeId = t.towerId ?? NO_OFFICE;
    usedOffices.add(officeId);

    const row = map.get(day) ?? { day, total: emptyAgg(), byOffice: new Map() };
    const moneyIn = t.moneyIn ?? 0;
    const moneyOut = t.moneyOut ?? 0;

    row.total.moneyIn += moneyIn;
    row.total.moneyOut += moneyOut;
    row.total.count += 1;

    const off = row.byOffice.get(officeId) ?? emptyAgg();
    off.moneyIn += moneyIn;
    off.moneyOut += moneyOut;
    off.count += 1;
    row.byOffice.set(officeId, off);

    map.set(day, row);
  }

  // قائمة المكاتب التي لها حركات فعلاً (بالترتيب: المكاتب المعرّفة ثم "غير محدد")
  const offices = [...usedOffices]
    .filter((id) => id !== NO_OFFICE)
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: towerName.get(id) ?? `مكتب ${id}` }));
  if (usedOffices.has(NO_OFFICE)) {
    offices.push({ id: NO_OFFICE, name: "غير محدد" });
  }

  const toRow = (a: OfficeAgg) => ({
    moneyIn: a.moneyIn,
    moneyOut: a.moneyOut,
    net: a.moneyIn - a.moneyOut,
    count: a.count,
  });

  // الأحدث أولاً
  const days = [...map.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map((r) => {
      const byOffice: Record<string, ReturnType<typeof toRow>> = {};
      for (const [officeId, agg] of r.byOffice) byOffice[String(officeId)] = toRow(agg);
      return { day: r.day, ...toRow(r.total), byOffice };
    });

  // مجموع صافي كل مكتب عبر كل الأيام (وكذلك الإجمالي)
  const totalByOffice: Record<string, number> = {};
  let total = 0;
  for (const r of days) {
    total += r.net;
    for (const [officeId, o] of Object.entries(r.byOffice)) {
      totalByOffice[officeId] = (totalByOffice[officeId] ?? 0) + o.net;
    }
  }

  return NextResponse.json({ offices, days, total, totalByOffice });
}
