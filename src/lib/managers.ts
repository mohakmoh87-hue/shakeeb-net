import { prisma } from "@/lib/prisma";

// ===== المدراء: هوية مالية لكل وكيل (2026-08-03) =====
// النموذج الذي أقرّه محمد بمثاله المفصّل:
//   رصيد المدير = **كل ما أودعه في النظام − كل ما سحبه منه**، عبر ثلاث قنوات:
//   ١ · مكاتبه: حساب مصروف/مقبوض له في كل مكتب. إعطاؤه المكتب = قبض للمكتب (moneyIn)
//       ⇒ رصيده يزيد؛ وسحبه = صرف من المكتب (moneyOut) ⇒ رصيده ينقص.
//       **يؤثر على التقرير اليومي لذلك المكتب** — ومنه يتأثر «المبلغ الكلي» مرة واحدة
//       (الكلي محسوب من التقارير، فلا خصم ثانٍ — شرط محمد الصريح).
//   ٢ · حسابات المدير: مقبوض/مصروف عام ⇒ يؤثر على «المبلغ الكلي» ورصيده، **لا على أي تقرير**.
//   ٣ · الماستر: قبض/صرف ماستر ⇒ يؤثر على رصيد الماستر ورصيده، **لا على التقارير ولا على الكلي**.
// وحركة بلا مدير (managerId = null) = من/إلى المبلغ الكلي مباشرة (مصاريف عامة كالإيجار)
// فلا تمسّ رصيد أي مدير.

export type ManagerBalance = {
  id: number;
  name: string;
  deposited: number;   // ما أودعه في النظام
  withdrawn: number;   // ما سحبه منه
  net: number;         // الصافي: موجب = له عند الشركة · سالب = عليه لها
  byOffice: { towerId: number; office: string; deposited: number; withdrawn: number; net: number }[];
  general: number;     // صافي حركاته في حسابات المدير (قناة ٢)
  master: number;      // صافي حركاته على الماستر (قناة ٣)
};

const MASTER_TYPES = ["master-receipt", "master-expense"];

// أرصدة كل مدراء الوكيل — بثلاث استعلامات مجمّعة (لا حلقة لكل مدير)
export async function managerBalances(agentId: number | null | undefined, towerIds: number[]): Promise<ManagerBalance[]> {
  if (agentId == null) return [];
  const managers = await prisma.manager.findMany({
    where: { agentId, isDeleted: false },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  if (!managers.length) return [];

  const towers = await prisma.tower.findMany({
    where: { id: { in: towerIds.length ? towerIds : [-1] } },
    select: { id: true, name: true },
  });
  const officeName = new Map(towers.map((t) => [t.id, t.name ?? `مكتب ${t.id}`]));

  // قناة ١: حسابات المدير في المكاتب — moneyIn = أودع للمكتب · moneyOut = سحب منه
  const accounts = await prisma.account.findMany({
    where: { isDeleted: false, managerId: { in: managers.map((m) => m.id) } },
    select: { id: true, managerId: true, towerId: true },
  });
  const accIds = accounts.map((a) => a.id);
  const officeAgg = accIds.length
    ? await prisma.moneyTx.groupBy({
        by: ["accountId"],
        where: { isDeleted: false, accountId: { in: accIds } },
        _sum: { moneyIn: true, moneyOut: true },
      })
    : [];
  const byAccount = new Map(officeAgg.map((r) => [r.accountId as number, r]));

  // قناتا ٢ و٣: حركات حسابات المدير المنسوبة لمدير
  const mgrAgg = await prisma.managerTx.groupBy({
    by: ["managerId", "type"],
    where: { isDeleted: false, agentId, managerId: { in: managers.map((m) => m.id) } },
    _sum: { amount: true },
  });

  return managers.map((m) => {
    const byOffice: ManagerBalance["byOffice"] = [];
    let deposited = 0, withdrawn = 0;
    for (const a of accounts.filter((x) => x.managerId === m.id)) {
      const agg = byAccount.get(a.id);
      const dep = agg?._sum.moneyIn ?? 0;   // أعطى المكتب
      const wd = agg?._sum.moneyOut ?? 0;   // سحب من المكتب
      deposited += dep; withdrawn += wd;
      if (a.towerId != null && (dep || wd)) {
        byOffice.push({ towerId: a.towerId, office: officeName.get(a.towerId) ?? `مكتب ${a.towerId}`, deposited: dep, withdrawn: wd, net: dep - wd });
      }
    }
    let general = 0, master = 0;
    for (const r of mgrAgg.filter((x) => x.managerId === m.id)) {
      const amt = r._sum.amount ?? 0;
      const isMaster = MASTER_TYPES.includes(r.type);
      // «مقبوض» = دخل مال للنظام من المدير (إيداع) · «مصروف» = خرج له (سحب)
      const isDeposit = r.type === "receipt" || r.type === "master-receipt";
      if (isDeposit) deposited += amt; else withdrawn += amt;
      if (isMaster) master += isDeposit ? amt : -amt;
      else general += isDeposit ? amt : -amt;
    }
    return { id: m.id, name: m.name, deposited, withdrawn, net: deposited - withdrawn, byOffice, general, master };
  });
}

// إنشاء حسابات المدير في كل مكاتب وكيله (وتُستدعى أيضاً عند إضافة مكتب جديد)
export async function ensureManagerAccounts(managerId: number, name: string, towerIds: number[]): Promise<number> {
  if (!towerIds.length) return 0;
  const existing = await prisma.account.findMany({
    where: { managerId, isDeleted: false },
    select: { towerId: true },
  });
  const have = new Set(existing.map((e) => e.towerId));
  const missing = towerIds.filter((t) => !have.has(t));
  if (!missing.length) return 0;
  await prisma.account.createMany({
    data: missing.map((towerId) => ({ name, typeName: "مدير", towerId, managerId, isEmployee: false })),
  });
  return missing.length;
}

// عند إنشاء مكتب جديد: يحصل كل مدراء الوكيل على حساب فيه تلقائياً
export async function ensureAccountsForNewOffice(agentId: number | null | undefined, towerId: number): Promise<void> {
  if (agentId == null) return;
  const managers = await prisma.manager.findMany({ where: { agentId, isDeleted: false }, select: { id: true, name: true } });
  for (const m of managers) await ensureManagerAccounts(m.id, m.name, [towerId]);
}
