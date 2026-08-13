import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSession, getTechSession } from "@/lib/auth";
import { cardCountsFor } from "@/lib/salary";

export const dynamic = "force-dynamic";

// ===== كشف الراتب: يُفتح ويُلغى (المرحلة ١٠) =====
// الكشف كان **مخزَّناً بكل تفاصيله ولا يُعرض منها شيء**: البنود المؤثّرة (الأيام،
// الإضافي، المكافآت، الخصومات) محفوظة في حقل details ولا تصل الواجهة أبداً — فتقرأ
// «صافي كذا» بلا سبيل لمعرفة كيف تكوّن. وإن حُذف قيد الصرف من مكان آخر، عاد المال
// وبقي الكشف يزعم أنه دُفع.
// بنود الكشف كما تُحفَظ فعلاً في details (label هو الوصف البشريّ، وtype التصنيف الآليّ).
// كان هذا النوع يقرأ «kind» غير الموجود فتظهر كلّ أسطر الكشوف السابقة **بوصفٍ فارغ** (عطبٌ أُصلح).
type Item = { date: string; type: string; label: string; amount: number; reason?: string; txId?: number };
type Day = { date: string; amount: number; note: string };
type StoredV2 = { v?: number; items?: Item[]; dayDetails?: Day[]; credits?: number; advances?: number; cleanDays?: number };

// يفكّ حقل details بالصيغتين: v2 (كائنٌ فيه البنود وتفصيل الأيام والمشتقّات) والقديمة (مصفوفة بنودٍ فقط).
// القديمة تُشتقّ منها المقبوضات/السلف من البنود نفسها، وتفصيل الأيام غير متوفّر فيها (لم يكن يُحفَظ).
function parseDetails(raw: string | null): { items: Item[]; dayDetails: Day[]; credits: number; advances: number; cleanDays: number | null } {
  let items: Item[] = [];
  let dayDetails: Day[] = [];
  let credits: number | null = null, advances: number | null = null, cleanDays: number | null = null;
  try {
    const parsed = JSON.parse(raw || "[]") as Item[] | StoredV2;
    if (Array.isArray(parsed)) items = parsed;
    else {
      items = parsed.items ?? [];
      dayDetails = parsed.dayDetails ?? [];
      credits = parsed.credits ?? null; advances = parsed.advances ?? null; cleanDays = parsed.cleanDays ?? null;
    }
  } catch { /* نص فاسد */ }
  const sum = (t: string) => items.filter((i) => i.type === t).reduce((s, i) => s + Math.abs(i.amount ?? 0), 0);
  return {
    items, dayDetails,
    credits: credits ?? sum("credit"),
    advances: advances ?? sum("advance"),
    cleanDays,
  };
}

async function loadOwned(id: number, session: Awaited<ReturnType<typeof getSession>>) {
  const st = await prisma.salaryStatement.findUnique({ where: { id } });
  if (!st) return null;
  const towers = await agentTowerIds(session ?? null);
  const ok = st.towerId == null ? st.agentId === (session?.agentId ?? -1) : towers.includes(st.towerId);
  return ok ? st : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // ===== الفنيّ يفتح كشوفه السابقة (طلب محمد 2026-08-09) =====
  // كان المسار محميّاً بصلاحيّة مدير فقط، وجلسة الفنيّ تُرفَض (401) فلا يفتح شيئاً بصمت.
  // عزلٌ صارم: الفنيّ لا يرى إلا كشفاً **معرّفُ فنيِّه = معرّفه هو**، ولا شيء غيره.
  const tech = await getTechSession();
  let st: Awaited<ReturnType<typeof loadOwned>> = null;
  if (tech) {
    const own = await prisma.salaryStatement.findUnique({ where: { id: Number(id) } });
    st = own && own.technicianId === tech.technicianId ? own : null;
  } else {
    const g = await guard("field.manage");
    if (g.error) return g.error;
    st = await loadOwned(Number(id), g.session);
  }
  if (!st) return NextResponse.json({ error: "الكشف غير موجود" }, { status: 404 });

  const parsed = parseDetails(st.details);
  const details = parsed.items;

  // حالة قيد الصرف المرتبط: إن حُذف من مكان آخر فالكشف يزعم دفعاً لم يعد قائماً
  const tx = st.moneyTxId
    ? await prisma.moneyTx.findUnique({ where: { id: st.moneyTxId }, select: { id: true, moneyOut: true, isDeleted: true, date: true } })
    : null;
  const cancelled = await prisma.auditLog.findFirst({
    where: { action: "SALARY_CANCEL", entity: "salaryStatement", entityId: String(st.id) },
    select: { id: true, createdAt: true },
  });

  // ما بقي من تلك الفترة ويُثري سجلّ المراجعة (طلب محمد): بطاقات الفترة (سجلّ دائم)،
  // وحركات حساب الموظّف المرتبطة بالكشف (السلف والمقبوضات — باقيةٌ موسومةً لا محذوفة).
  const [cardCounts, accountTxs] = await Promise.all([
    cardCountsFor(st.technicianId, st.periodFrom, st.periodTo),
    prisma.moneyTx.findMany({
      where: { salaryStatementId: st.id, isDeleted: false },
      select: { id: true, date: true, moneyIn: true, moneyOut: true, notes: true },
      orderBy: { date: "asc" },
    }),
  ]);

  return NextResponse.json({
    statement: {
      id: st.id, technicianName: st.technicianName, periodFrom: st.periodFrom, periodTo: st.periodTo,
      daysPaid: st.daysPaid, dailyAmount: st.dailyAmount, baseEarned: st.baseEarned,
      overtime: st.overtime, bonuses: st.bonuses,
      attendanceDeductions: st.attendanceDeductions, confirmedDeductions: st.confirmedDeductions,
      net: st.net, paidByUser: st.paidByUser, createdAt: st.createdAt,
      // مشتقّاتٌ من اللقطة المحفوظة (أو من البنود للكشوف القديمة)
      credits: parsed.credits, advances: parsed.advances, cleanDays: parsed.cleanDays,
    },
    details,                       // البنود كاملةً: date/type/label/amount/reason/txId
    dayDetails: parsed.dayDetails, // تفصيل الأيام — متوفّرٌ للكشوف المحفوظة بعد 2026-08-09
    cardCounts,
    accountTxs: accountTxs.map((m) => ({ id: m.id, date: m.date, moneyIn: m.moneyIn ?? 0, moneyOut: m.moneyOut ?? 0, notes: m.notes })),
    payment: tx ? { id: tx.id, amount: tx.moneyOut ?? 0, deleted: tx.isDeleted, date: tx.date } : null,
    cancelled: cancelled ? { at: cancelled.createdAt } : null,
  });
}

// إلغاء الكشف: يُعاد المال بحذف قيد الصرف، ويُوسَم الكشف ملغياً.
// ملاحظة صادقة: سجلات الحضور والخصومات والإجازات لتلك الفترة **تُحذف** لحظة التسديد،
// فلا يمكن إرجاعها — الإلغاء يُصحّح المال والسجل لا الفترة.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("receipts.void"); // للمدير وحده (شرط محمد)
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const st = await loadOwned(Number(id), g.session);
  if (!st) return NextResponse.json({ error: "الكشف غير موجود" }, { status: 404 });

  const already = await prisma.auditLog.findFirst({
    where: { action: "SALARY_CANCEL", entity: "salaryStatement", entityId: String(st.id) },
    select: { id: true },
  });
  if (already) return NextResponse.json({ error: "أُلغي هذا الكشف مسبقاً" }, { status: 400 });

  // ═════ (أ) · الإلغاءُ صار **عكسيّاً كاملاً** (قرارُ محمد 2026-08-13) ═════
  // كان يُصحّح المالَ والسجلَّ **لا الفترة**، لأنّ التسديدَ يمحو الحضورَ والخصوماتِ والإجازاتِ
  // محواً نهائيّاً. وقد صار التسديدُ **يَوسِمها** بمعرّف الكشف بدل حذفها ⇒ فالإلغاءُ يفكّ
  // الوسمَ فتعود **بأوقاتها الحقيقيّة** لا مُعادةً بالدوام. كلُّه في معاملةٍ واحدة.
  const undone = await prisma.$transaction(async (tx) => {
    // (١) فكُّ أوسمة الفترة — الحضورُ والخصوماتُ والإجازات
    const [att, adj, lv] = await Promise.all([
      tx.attendance.updateMany({ where: { salaryStatementId: st.id }, data: { salaryStatementId: null } }),
      tx.adjustment.updateMany({ where: { salaryStatementId: st.id }, data: { salaryStatementId: null } }),
      tx.leave.updateMany({ where: { salaryStatementId: st.id }, data: { salaryStatementId: null } }),
    ]);

    // (٢) قيدُ الصرف يُبطَل فيعود المالُ إلى الصندوق
    let moneyReturned = 0;
    if (st.moneyTxId) {
      const upd = await tx.moneyTx.updateMany({ where: { id: st.moneyTxId, isDeleted: false }, data: { isDeleted: true } });
      if (upd.count > 0) moneyReturned = st.net;
    }

    // (٣) 🔴 وقيدُ **الاستيفاء** (ب) يُبطَل أيضاً: تصفيرُ رصيدٍ سالبٍ أدخل مالاً إلى الصندوق،
    //     فإلغاءُ الكشف بلا إبطاله يُبقي مالاً قُبض على دَينٍ عاد ⇒ **قُبض مرّتَين**.
    //     ويُعرَف بأنّه حركةُ راتبٍ موسومةٌ بالكشف وفيها **قبضٌ** لا صرف.
    const collectVoid = await tx.moneyTx.updateMany({
      where: { salaryStatementId: st.id, sourceType: "salary", moneyIn: { gt: 0 }, isDeleted: false },
      data: { isDeleted: true },
    });

    // (٤) وحركاتُ حساب الموظّف (سحوباتُه ومقبوضاتُه) يُفَكُّ وسمُها فتُحتسَب في فترته القادمة
    const acct = await tx.moneyTx.updateMany({
      where: { salaryStatementId: st.id, isDeleted: false },
      data: { salaryStatementId: null },
    });

    // (٥) ويُوسَم الكشفُ ملغىً في عموده — لا في سجلّ التدقيق وحدَه
    await tx.salaryStatement.update({ where: { id: st.id }, data: { cancelledAt: new Date() } });

    return { att: att.count, adj: adj.count, lv: lv.count, moneyReturned, collectVoided: collectVoid.count, acct: acct.count };
  });

  await prisma.auditLog.create({
    data: {
      userId: session?.userId,
      action: "SALARY_CANCEL", entity: "salaryStatement", entityId: String(st.id),
      details:
        "إلغاء كشف راتب " + st.technicianName + " (" + st.periodFrom + " → " + st.periodTo + ") — " +
        "صافي " + st.net.toLocaleString("en-US") +
        " — أُعيد: " + undone.att + " بصمة · " + undone.adj + " خصم/مكافأة · " + undone.lv + " إجازة" +
        " · فُكَّ وسمُ " + undone.acct + " حركةَ حساب" +
        (undone.moneyReturned ? " · أُبطل قيدُ الصرف" : " · لا قيدَ صرفٍ قائم") +
        (undone.collectVoided ? " · وأُبطل قيدُ استيفاء التصفير" : ""),
    },
  });

  return NextResponse.json({
    ok: true,
    moneyReturned: undone.moneyReturned,
    restored: { attendance: undone.att, adjustments: undone.adj, leaves: undone.lv, accountTxs: undone.acct },
    collectVoided: undone.collectVoided,
    note: "رجعت بصمات الحضور والخصومات والإجازات بأوقاتها الحقيقية، وعادت حركات الحساب للاحتساب.",
  });
}
