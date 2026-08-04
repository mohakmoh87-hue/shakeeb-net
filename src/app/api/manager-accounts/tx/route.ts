import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  // card-debt-add / card-debt-sub: تعديل يدوي لديون الكارتات (زيادة/إنقاص)
  type: z.enum(["expense", "receipt", "card-payment", "master-receipt", "master-expense", "card-debt-add", "card-debt-sub"]),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  notes: z.string().nullable().optional(),
  // المدير صاحب الحركة — غائب/null = من/إلى المبلغ الكلي مباشرة بلا مساس بأي مدير
  // (المصاريف العامة كالإيجار). قرار محمد 2026-08-03: مصدر مختار لكل حركة.
  managerId: z.coerce.number().nullable().optional(),
});

// تسجيل حركة في حساب المدير (مصروف/مقبوض/تسديد كارتات) — لا تؤثر على التقرير اليومي
export async function POST(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const session = await getSession();
  const agentId = g.session.agentId ?? -1; // عزل المستأجر

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { type, amount, notes } = parsed.data;
  // عزل: المدير المُنسب إليه يجب أن يكون من مدراء وكيل المستخدم
  let managerId: number | null = null;
  if (parsed.data.managerId != null) {
    const m = await prisma.manager.findFirst({ where: { id: parsed.data.managerId, agentId, isDeleted: false }, select: { id: true } });
    if (!m) return NextResponse.json({ error: "المدير غير موجود" }, { status: 400 });
    managerId = m.id;
  }

  // حساب الماستر من صفحة المدير: طبقة وكيل كاملة بلا مكاتب (قرار محمد 2026-07-30) —
  // تُسجَّل في سجل حركات المدير (managerTx) فتؤثّر على رصيد ماستر صفحة المدير فقط،
  // ولا تدخل التقارير اليومية ولا ماستر أي مكتب إطلاقاً (كانت تُنسب قسراً لأول
  // مكتب فظهر صرف عمر على ماستر الرسالة بلا اختيار أحد).
  if (type === "master-receipt" || type === "master-expense") {
    const created = await prisma.managerTx.create({
      data: {
        type, amount,
        notes: notes ?? (type === "master-receipt" ? "قبض ماستر" : "صرف ماستر"),
        userId: session?.userId, agentId, managerId, byUser: g.session.fullName ?? g.session.username,
      },
    });
    return NextResponse.json({ ok: true, id: created.id, master: true }, { status: 201 });
  }

  // منع تسديد كارتات أكثر من الدين المتبقّي — ضمن كروت/حركات الوكيل فقط
  // (يشمل التعديلات اليدوية: card-debt-add يزيد الدين وcard-debt-sub يُنقصه)
  if (type === "card-payment") {
    const [cardsAgg, mgr] = await Promise.all([
      prisma.rechargeCard.aggregate({ where: { agentId }, _sum: { price: true } }),
      prisma.managerTx.groupBy({ by: ["type"], where: { isDeleted: false, agentId, type: { in: ["card-payment", "card-debt-add", "card-debt-sub"] } }, _sum: { amount: true } }),
    ]);
    const sumBy = (t: string) => mgr.find((m) => m.type === t)?._sum.amount ?? 0;
    const remaining = (cardsAgg._sum.price ?? 0) + sumBy("card-debt-add") - sumBy("card-debt-sub") - sumBy("card-payment");
    if (amount > remaining + 0.001) {
      return NextResponse.json({ error: `المبلغ أكبر من ديون الكارتات المتبقّية (${remaining.toLocaleString("en-US")})` }, { status: 400 });
    }
  }

  const created = await prisma.managerTx.create({
    data: { type, amount, notes: notes ?? null, userId: session?.userId, agentId, managerId, byUser: g.session.fullName ?? g.session.username },
  });
  return NextResponse.json(created, { status: 201 });
}

// حذف حركة مدير (عكسي) — مقيّد بحركات وكيل المستخدم (عزل)
export async function DELETE(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });
  await prisma.managerTx.updateMany({ where: { id, isDeleted: false, agentId }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
