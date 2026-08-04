import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ===== كشف الراتب: يُفتح ويُلغى (المرحلة ١٠) =====
// الكشف كان **مخزَّناً بكل تفاصيله ولا يُعرض منها شيء**: البنود المؤثّرة (الأيام،
// الإضافي، المكافآت، الخصومات) محفوظة في حقل details ولا تصل الواجهة أبداً — فتقرأ
// «صافي كذا» بلا سبيل لمعرفة كيف تكوّن. وإن حُذف قيد الصرف من مكان آخر، عاد المال
// وبقي الكشف يزعم أنه دُفع.
type Detail = { date?: string; kind?: string; amount?: number; reason?: string };

async function loadOwned(id: number, session: Awaited<ReturnType<typeof getSession>>) {
  const st = await prisma.salaryStatement.findUnique({ where: { id } });
  if (!st) return null;
  const towers = await agentTowerIds(session ?? null);
  const ok = st.towerId == null ? st.agentId === (session?.agentId ?? -1) : towers.includes(st.towerId);
  return ok ? st : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const { id } = await params;
  const st = await loadOwned(Number(id), g.session);
  if (!st) return NextResponse.json({ error: "الكشف غير موجود" }, { status: 404 });

  let details: Detail[] = [];
  try { details = JSON.parse(st.details || "[]") as Detail[]; } catch { /* نص فاسد */ }

  // حالة قيد الصرف المرتبط: إن حُذف من مكان آخر فالكشف يزعم دفعاً لم يعد قائماً
  const tx = st.moneyTxId
    ? await prisma.moneyTx.findUnique({ where: { id: st.moneyTxId }, select: { id: true, moneyOut: true, isDeleted: true, date: true } })
    : null;
  const cancelled = await prisma.auditLog.findFirst({
    where: { action: "SALARY_CANCEL", entity: "salaryStatement", entityId: String(st.id) },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({
    statement: {
      id: st.id, technicianName: st.technicianName, periodFrom: st.periodFrom, periodTo: st.periodTo,
      daysPaid: st.daysPaid, dailyAmount: st.dailyAmount, baseEarned: st.baseEarned,
      overtime: st.overtime, bonuses: st.bonuses,
      attendanceDeductions: st.attendanceDeductions, confirmedDeductions: st.confirmedDeductions,
      net: st.net, paidByUser: st.paidByUser, createdAt: st.createdAt,
    },
    details,
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

  let moneyReturned = 0;
  if (st.moneyTxId) {
    const upd = await prisma.moneyTx.updateMany({ where: { id: st.moneyTxId, isDeleted: false }, data: { isDeleted: true } });
    if (upd.count > 0) moneyReturned = st.net;
  }

  await prisma.auditLog.create({
    data: {
      userId: session?.userId,
      action: "SALARY_CANCEL", entity: "salaryStatement", entityId: String(st.id),
      details:
        "إلغاء كشف راتب " + st.technicianName + " (" + st.periodFrom + " → " + st.periodTo + ") — " +
        "صافي " + st.net.toLocaleString("en-US") +
        (moneyReturned ? " — أُعيد المال بحذف قيد الصرف" : " — قيد الصرف كان محذوفاً مسبقاً"),
    },
  });

  return NextResponse.json({
    ok: true,
    moneyReturned,
    note: "سجلات الحضور والخصومات لتلك الفترة حُذفت لحظة التسديد فلا تعود — الإلغاء صحّح المال والسجل.",
  });
}
