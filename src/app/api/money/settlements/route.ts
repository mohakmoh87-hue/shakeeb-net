import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope, ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== تسديد مكاتب التفعيل/التوصيل (طلب محمد 2026-08-05) =====
// ما يُحسم على «مكتب تفعيل» (وسام الغدير مثلاً) يُقيَّد مصروفاً على حسابه ويبقى ديناً عليه
// حتى يسدّده أسبوعياً أو شهرياً. لم يكن في البرنامج مكانٌ يُظهر هذا الدين ولا زرّ يُسدّده:
// كان المبلغ يتراكم في صفوفٍ متفرّقة لا يجمعها شيء، ويُسدَّد على ورقة خارج النظام.
//
// الآن: هذه الشاشة تجمع لكل مكتبٍ ما عليه من قيودٍ غير مسدَّدة، وتسدّدها كلّها أو بعضها.
// التسديد يُنشئ **حركة قبض واحدة بتاريخ اليوم** (sourceType = office-settle) فتدخل تقرير
// اليوم الذي ضُغط فيه لا يوم القيد الأصلي — لأن المال وصل الصندوق اليوم. والقيود المشمولة
// تُوسَم settledAt + settledTxId. ورفع الوسم عن قيدٍ يُنقص حركة القبض بمقداره (وتُلغى إن
// فرغت) — فلا مالٌ يُقبض مرّتين ولا يضيع قيدٌ من الدين.

// الحساب مكتب تسديد؟ (نفس علامة «مكتب تفعيل» التي يضعها المدير على الحساب)
const SETTLE_TYPE = "office-settle";

async function scopedAccounts(session: Parameters<typeof towerScope>[0]) {
  return prisma.account.findMany({
    where: { isDeleted: false, isActivationOffice: true, ...(await towerScope(session)) },
    select: { id: true, name: true, towerId: true },
    orderBy: { id: "asc" },
  });
}

// GET            ⇒ قائمة مكاتب التسديد وما على كلٍّ منها
// GET ?accountId ⇒ قيود ذلك المكتب (غير المسدَّدة، ومعها المسدَّدة إن طُلبت ?settled=1)
export async function GET(request: Request) {
  const g = await guard("finance.view");
  if (g.error) return g.error;

  const sp = new URL(request.url).searchParams;
  const accountId = Number(sp.get("accountId")) || null;
  const withSettled = sp.get("settled") === "1";

  const accounts = await scopedAccounts(g.session);
  if (!accounts.length) return NextResponse.json({ offices: [], rows: [] });

  if (accountId != null) {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return NextResponse.json({ error: "الحساب لا يتبع حسابك" }, { status: 403 });
    const rows = await prisma.moneyTx.findMany({
      where: {
        accountId, isDeleted: false, sourceType: { not: SETTLE_TYPE },
        ...(withSettled ? {} : { settledAt: null }),
      },
      orderBy: { id: "desc" },
      take: 500,
      select: { id: true, date: true, moneyIn: true, moneyOut: true, notes: true, settledAt: true, settledTxId: true, sourceType: true, sourceId: true },
    });
    return NextResponse.json({ account: acc, rows });
  }

  // ما على كل مكتب: مجموع (مصروف − مقبوض) على قيوده غير المسدَّدة
  const ids = accounts.map((a) => a.id);
  const open = await prisma.moneyTx.groupBy({
    by: ["accountId"],
    where: { accountId: { in: ids }, isDeleted: false, settledAt: null, sourceType: { not: SETTLE_TYPE } },
    _sum: { moneyIn: true, moneyOut: true },
    _count: true,
  });
  const byId = new Map(open.map((o) => [o.accountId, o]));
  const towers = await prisma.tower.findMany({ where: { id: { in: [...new Set(accounts.map((a) => a.towerId).filter((x): x is number => x != null))] } }, select: { id: true, name: true } });
  const officeName = new Map(towers.map((t) => [t.id, t.name]));

  return NextResponse.json({
    offices: accounts.map((a) => {
      const o = byId.get(a.id);
      const owed = (o?._sum.moneyOut ?? 0) - (o?._sum.moneyIn ?? 0);
      return { id: a.id, name: a.name, towerId: a.towerId, office: a.towerId != null ? officeName.get(a.towerId) ?? null : null, owed, count: o?._count ?? 0 };
    }),
  });
}

// POST { accountId, txIds? }            ⇒ تسديد الكل أو المحدَّد
// POST { unsettle: true, txIds: [...] } ⇒ إرجاع قيود إلى «غير مسدَّدة»
export async function POST(request: Request) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const txIds = Array.isArray(body?.txIds) ? (body.txIds as unknown[]).map(Number).filter(Number.isFinite) : [];
  const actor = g.session?.fullName ?? g.session?.username ?? null;

  // ===== إرجاع قيد إلى الدين =====
  if (body?.unsettle === true) {
    if (!txIds.length) return NextResponse.json({ error: "حدّد القيود المطلوب إرجاعها" }, { status: 400 });
    const accounts = await scopedAccounts(g.session);
    const ids = new Set(accounts.map((a) => a.id));
    const rows = await prisma.moneyTx.findMany({
      where: { id: { in: txIds }, isDeleted: false, settledAt: { not: null } },
      select: { id: true, accountId: true, moneyIn: true, moneyOut: true, settledTxId: true, notes: true },
    });
    const owned = rows.filter((r) => r.accountId != null && ids.has(r.accountId));
    if (!owned.length) return NextResponse.json({ error: "لا قيد مسدَّد مطابق ضمن حسابك" }, { status: 404 });

    let reverted = 0;
    await prisma.$transaction(async (tx) => {
      // كل قيد يُنقص حركة تسديده بمقداره — فيبقى تقرير يوم التسديد صادقاً بما بقي فعلاً
      const byTx = new Map<number, number>();
      for (const r of owned) {
        const val = (r.moneyOut ?? 0) - (r.moneyIn ?? 0);
        if (r.settledTxId != null) byTx.set(r.settledTxId, (byTx.get(r.settledTxId) ?? 0) + val);
      }
      await tx.moneyTx.updateMany({ where: { id: { in: owned.map((r) => r.id) } }, data: { settledAt: null, settledTxId: null } });
      reverted = owned.length;
      for (const [stx, amount] of byTx) {
        const s = await tx.moneyTx.findUnique({ where: { id: stx }, select: { id: true, moneyIn: true, notes: true } });
        if (!s) continue;
        const left = Math.max(0, (s.moneyIn ?? 0) - amount);
        if (left <= 0) {
          await tx.moneyTx.update({ where: { id: s.id }, data: { isDeleted: true, notes: `${s.notes ?? ""} — أُلغي: أُرجعت كل قيوده إلى الدين` } });
        } else {
          await tx.moneyTx.update({ where: { id: s.id }, data: { moneyIn: left, notes: `${s.notes ?? ""} — نقص ${amount.toLocaleString("en-US")} (إرجاع قيود)` } });
        }
      }
      await tx.auditLog.create({
        data: {
          userId: g.session?.userId ?? null, action: "OFFICE_UNSETTLE", entity: "moneyTx",
          entityId: owned.length === 1 ? String(owned[0].id) : String(owned.length),
          details: `إرجاع ${owned.length} قيد إلى الدين — نقص حركات التسديد بمجموع ${[...byTx.values()].reduce((s, v) => s + v, 0).toLocaleString("en-US")}${actor ? ` — بواسطة ${actor}` : ""}`,
        },
      });
    });
    return NextResponse.json({ ok: true, reverted });
  }

  // ===== التسديد =====
  const accountId = Number(body?.accountId);
  if (!accountId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  const accounts = await scopedAccounts(g.session);
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return NextResponse.json({ error: "الحساب لا يتبع حسابك" }, { status: 403 });
  if (acc.towerId == null || !(await ownsTower(g.session, acc.towerId))) {
    return NextResponse.json({ error: "حساب المكتب بلا مكتب — لا يمكن تسجيل التسديد" }, { status: 400 });
  }

  const rows = await prisma.moneyTx.findMany({
    where: {
      accountId, isDeleted: false, settledAt: null, sourceType: { not: SETTLE_TYPE },
      ...(txIds.length ? { id: { in: txIds } } : {}),
    },
    select: { id: true, moneyIn: true, moneyOut: true },
  });
  if (!rows.length) return NextResponse.json({ error: "لا قيود غير مسدَّدة" }, { status: 400 });

  const total = rows.reduce((s, r) => s + (r.moneyOut ?? 0) - (r.moneyIn ?? 0), 0);
  if (total <= 0) return NextResponse.json({ error: "المجموع المحدَّد صفر أو سالب — راجع القيود" }, { status: 400 });

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const settle = await tx.moneyTx.create({
      data: {
        moneyIn: total, moneyOut: 0,
        accountId, towerId: acc.towerId,
        sourceType: SETTLE_TYPE,
        date: now, serverDate: now, userId: g.session?.userId ?? null,
        notes: `تسديد مكتب «${acc.name ?? accountId}» — ${rows.length} قيد بمجموع ${total.toLocaleString("en-US")}`,
      },
    });
    await tx.moneyTx.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { settledAt: now, settledTxId: settle.id } });
    await tx.auditLog.create({
      data: {
        userId: g.session?.userId ?? null, action: "OFFICE_SETTLE", entity: "account", entityId: String(accountId),
        details:
          `تسديد مكتب «${acc.name ?? accountId}»: ${rows.length} قيد بمجموع ${total.toLocaleString("en-US")} د.ع` +
          ` — قُيّد قبضاً بتاريخ اليوم فيدخل تقرير اليوم${actor ? ` — بواسطة ${actor}` : ""}`,
      },
    });
    return settle;
  });

  return NextResponse.json({ ok: true, settled: rows.length, total, txId: result.id });
}
