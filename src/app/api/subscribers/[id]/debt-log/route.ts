import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== دفتر دين المشترك (المرحلة ٧) =====
// الدين كان **رقماً واحداً بلا دفتر**: عمود carry يُكتب فوقه من سبعة مواضع (تفعيل،
// ديون سابقة، فاتورة، تسديد، مسح، حذف وصل، تعديل بيانات المشترك) — فلا تعرف من أين
// جاء ولا لماذا تغيّر ولا كيف تسحب خطأً فيه.
//
// لا جدول جديد: الدفتر يُبنى من المصادر التي أنشأت الدين فعلاً —
//   · وصولات التفعيل: ما لم يصل منها (money + addPrice − moneyIn)
//   · الفواتير: المفوتَر ناقص الواصل
//   · حركات تسديد الدين (sourceType="debt")
//   · قيود إسقاط الدين (audit CLEAR_DEBT)
// ومجموعها المتوقَّع يُقارَن بـcarry الحالي، ويُعرض الفرق صراحةً إن وُجد بدل إخفائه.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const subscriberId = Number(id);
  if (!subscriberId) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });

  const sub = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { id: true, name: true, netUser: true, carry: true, towerId: true, isDeleted: true },
  });
  if (!sub || sub.isDeleted || !(await sameAgentTower(g.session, sub.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const [entries, invoices, payments, clears] = await Promise.all([
    prisma.subscriptionEntry.findMany({
      where: { subscriberId, isDeleted: false },
      orderBy: { id: "desc" },
      take: 500,
      select: { id: true, date: true, cardType: true, money: true, addPrice: true, moneyIn: true, createdByUser: true },
    }),
    prisma.invoice.findMany({
      where: { subscriberId, isDeleted: false },
      orderBy: { id: "desc" },
      take: 500,
      select: { id: true, number: true, date: true, totalMy: true, waselHim: true, type: true, user: true },
    }),
    prisma.moneyTx.findMany({
      // تسديد الدين نقداً (debt) أو على الماستر (master-debt) — كلاهما يُنقص الدين
      where: { sourceType: { in: ["debt", "master-debt"] }, sourceId: subscriberId, isDeleted: false },
      orderBy: { id: "desc" },
      take: 500,
      select: { id: true, date: true, moneyIn: true, notes: true, userId: true, sourceType: true },
    }),
    prisma.auditLog.findMany({
      where: { action: "CLEAR_DEBT", entity: "subscriber", entityId: String(subscriberId) },
      orderBy: { id: "desc" },
      take: 200,
      select: { id: true, createdAt: true, details: true, userId: true },
    }),
  ]);

  const userIds = [...new Set([...payments.map((p) => p.userId), ...clears.map((c) => c.userId)].filter((x): x is number => x != null))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.fullName ?? u.username]));

  type Row = { key: string; date: Date | null; kind: string; added: number; paid: number; note: string | null; by: string | null };
  const rows: Row[] = [
    ...entries
      .map((e) => ({
        key: `e${e.id}`,
        date: e.date,
        kind: "تفعيل",
        added: Math.max(0, (e.money ?? 0) + (e.addPrice ?? 0) - (e.moneyIn ?? 0)),
        paid: 0,
        note: `وصل #${e.id}${e.cardType ? ` — ${e.cardType}` : ""}`,
        by: e.createdByUser ?? null,
      }))
      .filter((r) => r.added > 0),
    ...invoices
      .map((v) => ({
        key: `v${v.id}`,
        date: v.date,
        kind: v.type ?? "فاتورة",
        added: Math.max(0, (v.totalMy ?? 0) - (v.waselHim ?? 0)),
        paid: 0,
        note: `فاتورة رقم ${v.number ?? v.id}`,
        by: v.user ?? null,
      }))
      .filter((r) => r.added > 0),
    ...payments.map((p) => ({
      key: `p${p.id}`,
      date: p.date,
      kind: p.sourceType === "master-debt" ? "تسديد (ماستر)" : "تسديد",
      added: 0,
      paid: p.moneyIn ?? 0,
      note: p.notes,
      by: p.userId != null ? userName.get(p.userId) ?? null : null,
    })),
    ...clears.map((c) => ({
      key: `c${c.id}`,
      date: c.createdAt,
      kind: "إسقاط دين",
      added: 0,
      paid: Number(c.details?.match(/مسح دين\s+(\d+(?:\.\d+)?)/)?.[1] ?? 0),
      note: c.details,
      by: c.userId != null ? userName.get(c.userId) ?? null : null,
    })),
  ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  const added = rows.reduce((s, r) => s + r.added, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  const expected = added - paid;
  const carry = sub.carry ?? 0;

  return NextResponse.json({
    subscriber: { id: sub.id, name: sub.name, netUser: sub.netUser },
    rows,
    totals: {
      added,
      paid,
      expected,
      carry,
      // فرقٌ يعني أن الدين عُدِّل من خارج هذه المصادر (تعديل يدوي قديم مثلاً) —
      // يُعرض بدل أن يُخفى
      diff: carry - expected,
    },
  });
}
