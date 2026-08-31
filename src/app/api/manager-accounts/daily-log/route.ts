import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { notMaster } from "@/lib/moneyKinds";

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
// إضافةً للإجمالي، نُرجع تفصيل كل يوم حسب المكتب (البرج)، ولمكاتب الحساب المنفصل
// (مستخدمان+ وفيهم مؤشَّر) نُرجع أيضاً تفصيله حسب المستخدم ليعرض المدير مبالغ كل
// مستخدمٍ منهم عبر كل الأيام — دون أي تأثير على طريقة حساب المبالغ نفسها.
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  // عزل المستأجر: مكاتب وكيل المستخدم فقط
  const agentTowers = await agentTowerIds(g.session);
  const [txs, towers, officeUsers] = await Promise.all([
    prisma.moneyTx.findMany({
      // باستثناء حساب الماستر (مستقل عن التقرير اليومي)
      where: { isDeleted: false, towerId: { in: agentTowers }, ...notMaster },
      select: { moneyIn: true, moneyOut: true, date: true, towerId: true, userId: true },
      orderBy: { date: "asc" },
    }),
    prisma.tower.findMany({
      where: { isDeleted: false, id: { in: agentTowers } },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    }),
    prisma.user.findMany({
      where: { towerId: { in: agentTowers }, isDeleted: false, isActive: true, isOwner: false },
      select: { id: true, fullName: true, username: true, towerId: true, separateAccount: true },
      orderBy: { id: "asc" },
    }),
  ]);

  // اسم كل مكتب حسب معرّفه
  const towerName = new Map<number, string>();
  for (const t of towers) towerName.set(t.id, t.name ?? `مكتب ${t.id}`);

  // ═════ مكاتب الحساب المنفصل ومستخدموها (مستخدمان+ وفيهم مؤشَّر) ═════
  // نفسُ قاعدة `officeSeparated`: البرجُ منفصلٌ إن كان له مستخدمان فأكثر وفيهم واحدٌ مفصولٌ
  // على الأقلّ — فيُظهَر تفرّعُ المستخدمين في القائمة. غيرُه يبقى مكتباً واحداً بلا تغيير.
  const usersOfTower = new Map<number, { id: number; name: string }[]>();
  const sepFlag = new Map<number, { count: number; hasSep: boolean }>();
  for (const u of officeUsers) {
    if (u.towerId == null) continue;
    const arr = usersOfTower.get(u.towerId) ?? [];
    arr.push({ id: u.id, name: u.fullName || u.username });
    usersOfTower.set(u.towerId, arr);
    const f = sepFlag.get(u.towerId) ?? { count: 0, hasSep: false };
    f.count += 1;
    if (u.separateAccount) f.hasSep = true;
    sepFlag.set(u.towerId, f);
  }
  const separatedOffices: { towerId: number; users: { id: number; name: string }[] }[] = [];
  const separatedTowerIds = new Set<number>();
  const userIdsOfTower = new Map<number, Set<number>>();
  for (const [towerId, f] of sepFlag) {
    if (f.count >= 2 && f.hasSep) {
      separatedOffices.push({ towerId, users: usersOfTower.get(towerId) ?? [] });
      separatedTowerIds.add(towerId);
      userIdsOfTower.set(towerId, new Set((usersOfTower.get(towerId) ?? []).map((u) => u.id)));
    }
  }

  // تجميع: يوم → (إجمالي + تفصيل حسب المكتب + تفصيل حسب المستخدم للمكاتب المنفصلة)
  const map = new Map<
    string,
    { day: string; total: OfficeAgg; byOffice: Map<number, OfficeAgg>; byUser: Map<number, OfficeAgg> }
  >();
  const usedOffices = new Set<number>();

  for (const t of txs) {
    if (!t.date) continue;
    const day = baghdadDay(t.date);
    const officeId = t.towerId ?? NO_OFFICE;
    usedOffices.add(officeId);

    const row = map.get(day) ?? { day, total: emptyAgg(), byOffice: new Map(), byUser: new Map() };
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

    // تفصيلُ المستخدم: للمكاتب المنفصلة حصراً، وللحركةِ المنسوبةِ لأحد مستخدمي المكتب نفسِه
    if (t.userId != null && separatedTowerIds.has(officeId) && userIdsOfTower.get(officeId)?.has(t.userId)) {
      const u = row.byUser.get(t.userId) ?? emptyAgg();
      u.moneyIn += moneyIn;
      u.moneyOut += moneyOut;
      u.count += 1;
      row.byUser.set(t.userId, u);
    }

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
      const byUser: Record<string, ReturnType<typeof toRow>> = {};
      for (const [userId, agg] of r.byUser) byUser[String(userId)] = toRow(agg);
      return { day: r.day, ...toRow(r.total), byOffice, byUser };
    });

  // مجموع صافي كل مكتب/مستخدم عبر كل الأيام (وكذلك الإجمالي)
  const totalByOffice: Record<string, number> = {};
  const totalByUser: Record<string, number> = {};
  let total = 0;
  for (const r of days) {
    total += r.net;
    for (const [officeId, o] of Object.entries(r.byOffice)) {
      totalByOffice[officeId] = (totalByOffice[officeId] ?? 0) + o.net;
    }
    for (const [userId, o] of Object.entries(r.byUser)) {
      totalByUser[userId] = (totalByUser[userId] ?? 0) + o.net;
    }
  }

  return NextResponse.json({ offices, separatedOffices, days, total, totalByOffice, totalByUser });
}
