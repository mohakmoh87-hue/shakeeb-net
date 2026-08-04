import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope, agentTowerIds } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  type: z.enum(["in", "out"]), // قبض / صرف
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  accountId: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string().optional(),
  master: z.boolean().optional(), // حركة على حساب الماستر (مستقل عن الصندوق اليومي)
});

export async function GET(request: Request) {
  const g = await guard("finance.view");
  if (g.error) return g.error;

  const sp = new URL(request.url).searchParams;
  const accountId = sp.get("accountId");
  const from = sp.get("from"); // yyyy-MM-dd (شامل)
  const to = sp.get("to"); // yyyy-MM-dd (شامل)
  const q = (sp.get("q") ?? "").trim(); // بحث حر: ملاحظات / اسم الحساب / رقم الحركة / المبلغ
  // فلتر التاريخ حسب حقل date (يشمل يوم البداية ويوم النهاية كاملاً)
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) dateFilter.gte = d; }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); dateFilter.lte = d; } }

  // البحث الحر: يطابق الملاحظات، أو حساباً اسمه يحوي النص، أو رقم الحركة/المبلغ إن كان رقماً
  let qWhere: object = {};
  if (q) {
    const qAccounts = await prisma.account.findMany({
      where: { isDeleted: false, name: { contains: q, mode: "insensitive" } },
      select: { id: true },
    });
    const qNum = Number(q.replace(/[,،]/g, ""));
    qWhere = {
      OR: [
        { notes: { contains: q, mode: "insensitive" } },
        ...(qAccounts.length ? [{ accountId: { in: qAccounts.map((a) => a.id) } }] : []),
        ...(Number.isFinite(qNum) && qNum > 0 ? [{ id: qNum }, { moneyIn: qNum }, { moneyOut: qNum }] : []),
      ],
    };
  }

  // صفحة الصندوق للحركات اليدوية فقط (المصروفات والمقبوضات) — التفعيلات/الفواتير تُدار من صفحاتها
  const where = {
    isDeleted: false,
    AND: [
      { OR: [{ sourceType: null }, { sourceType: "manual" }] },
      ...(q ? [qWhere] : []),
    ],
    ...(await towerScope(g.session)),
    ...(accountId ? { accountId: Number(accountId) } : {}),
    ...(dateFilter.gte || dateFilter.lte ? { date: dateFilter } : {}),
  };

  const [transactions, agg, accounts] = await Promise.all([
    prisma.moneyTx.findMany({ where, orderBy: { id: "desc" }, take: 200 }),
    prisma.moneyTx.aggregate({
      where,
      _sum: { moneyIn: true, moneyOut: true },
    }),
    prisma.account.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true },
    }),
  ]);

  const nameMap = new Map(accounts.map((a) => [a.id, a.name]));
  const totalIn = agg._sum.moneyIn ?? 0;
  const totalOut = agg._sum.moneyOut ?? 0;

  return NextResponse.json({
    transactions: transactions.map((t) => ({
      ...t,
      accountName: t.accountId ? nameMap.get(t.accountId) ?? null : null,
    })),
    summary: { totalIn, totalOut, balance: totalIn - totalOut },
  });
}

export async function POST(request: Request) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { type, amount, accountId, notes, date, master } = parsed.data;

  // حساب الماستر (master=true) صار **صفةً للحركة لا بديلاً عن الحساب**: تُسجَّل بـ
  // sourceType="master" فلا تدخل الصندوق اليومي وتظهر في سطر الماستر، **ومع ذلك تبقى
  // منسوبة للحساب المختار**. بذلك يستطيع المدير إيداع/سحب ماستر من مكتب على حساب
  // مدير باسمه، ويستطيع الفني سحب مبلغ من الماستر على حسابه — وكان ذلك مستحيلاً حين
  // كان اختيار «ماستر» يمسح الحساب. ونسبة المكتب تمرّ بنفس منطق بقية الحركات أدناه،
  // فلم يعد الماستر يتطلّب أن يكون لحساب المستخدم مكتب (يكفي حساب مرتبط بمكتب).

  // نسب الحركة لمكتب دائماً — قيد بلا towerId لا يظهر في أي تقرير أو صندوق
  // (حادثة وكيل سيف 2026-07-29: مصروفا 5000 من مدير بلا مكتب «اختفيا»):
  // مكتب المستخدم، وإلا مكتب الحساب المختار، وإلا مكتب الوكيل الوحيد إن كان واحداً.
  const agentTowers = await agentTowerIds(session);
  let towerId: number | null = session?.towerId ?? null;
  let account: { id: number; towerId: number | null } | null = null;
  if (accountId) {
    account = await prisma.account.findFirst({
      where: { id: accountId, isDeleted: false },
      select: { id: true, towerId: true },
    });
    // عزل: لا يُقيَّد على حساب مكتبٍ من خارج وكيل المستخدم
    if (!account || (account.towerId != null && !agentTowers.includes(account.towerId))) {
      return NextResponse.json({ error: "الحساب غير موجود" }, { status: 404 });
    }
  }
  if (towerId == null) towerId = account?.towerId ?? null;
  if (towerId == null && agentTowers.length === 1) towerId = agentTowers[0];
  if (towerId == null) {
    return NextResponse.json(
      { error: "حسابك بلا مكتب — اختر حساباً مرتبطاً بمكتب حتى يُنسب القيد له ويظهر في التقرير اليومي" },
      { status: 400 },
    );
  }

  const created = await prisma.moneyTx.create({
    data: {
      moneyIn: type === "in" ? amount : 0,
      moneyOut: type === "out" ? amount : 0,
      accountId: accountId ?? null,
      notes: notes ?? (master ? (type === "in" ? "قبض ماستر" : "صرف ماستر") : null),
      date: date ? new Date(date) : new Date(),
      userId: session?.userId,
      serverDate: new Date(),
      sourceType: master ? "master" : "manual", towerId,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
