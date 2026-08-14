import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  // card-debt-add / card-debt-sub: تعديل يدوي لديون الكارتات (زيادة/إنقاص)
  // convert-to-master / convert-from-master: أ-٥/٢ · تحويلُ مبلغٍ بين الكلّي والماستر —
  //   زوجُ حركتَين بالأنواع الأربعة القائمة نفسِها فلا يتغيّر أيُّ حسابٍ في أيّ شاشة
  type: z.enum(["expense", "receipt", "card-payment", "master-receipt", "master-expense", "card-debt-add", "card-debt-sub", "convert-to-master", "convert-from-master"]),
  // ب-٠٠ · جذرُ الكسر: لا كسورَ في الدينار العراقي (والكسرُ هنا يسري إلى «ما سحبه» فيُفسده)
  amount: z.coerce.number().int("المبلغ يجب أن يكون عدداً صحيحاً — لا كسور في الدينار العراقي").positive("المبلغ يجب أن يكون أكبر من صفر"),
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

  // ═════ أ-٥/٢ · تحويلٌ بين «المبلغ الكلّي» و«حساب الماستر» (طلب محمد) ═════
  // زوجُ حركتَين بالأنواع القائمة: إلى الماستر = صرفٌ من الكلّي + قبضُ ماستر، ومن الماستر
  // = صرفُ ماستر + قبضٌ للكلّي. فمجموعُ (الكلّي + الماستر) لا يتغيّر — نقلُ دفترٍ لا خلقُ مال.
  // والعلامةُ المشتركة «زوج #N» في ملاحظة كلِّ شقٍّ — بها يُحذفان معاً دفعةً واحدة (DELETE أدناه).
  if (type === "convert-to-master" || type === "convert-from-master") {
    const toMaster = type === "convert-to-master";
    const base = notes?.trim() || (toMaster ? "⇄ تحويل من الكلي إلى الماستر" : "⇄ تحويل من الماستر إلى الكلي");
    const common = { amount, userId: session?.userId, agentId, managerId: null, byUser: g.session.fullName ?? g.session.username };
    const pair = await prisma.$transaction(async (t) => {
      // الشقُّ الأوّل: الخروجُ من الدفتر المصدر
      const a = await t.managerTx.create({
        data: { ...common, type: toMaster ? "expense" : "master-expense", notes: base },
      });
      // الشقُّ الثاني: الدخولُ في الدفتر الآخر — ويحمل رقمَ شقّه
      const b = await t.managerTx.create({
        data: { ...common, type: toMaster ? "master-receipt" : "receipt", notes: `${base} (زوج #${a.id})` },
      });
      await t.managerTx.update({ where: { id: a.id }, data: { notes: `${base} (زوج #${b.id})` } });
      await t.auditLog.create({
        data: {
          userId: session?.userId, action: "TRANSFER_TOTAL_MASTER", entity: "managerTx", entityId: String(a.id),
          details: `تحويل ${amount} ${toMaster ? "من الكلي إلى الماستر" : "من الماستر إلى الكلي"}` +
                   ` — الزوج #${a.id}/#${b.id} — ⚖️ مجموعُ (الكلّي + الماستر) لم يتغيّر`,
        },
      });
      return { aId: a.id, bId: b.id };
    });
    return NextResponse.json({
      ok: true, ...pair,
      message: toMaster
        ? `حُوِّل ${amount.toLocaleString("en-US")} من الكلي إلى الماستر`
        : `حُوِّل ${amount.toLocaleString("en-US")} من الماستر إلى الكلي`,
    }, { status: 201 });
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

  // تسديد الكارتات يجوز أن يتجاوز الدين المتبقّي (طلب محمد 2026-08-08): الفائض يُسجَّل
  // ويجعل الدين بالسالب (رصيدٌ لك)، فيُخصَم تلقائيّاً من الكارتات الجديدة عبر معادلة ديون
  // الكارتات (المتبقّي = كلفة الكروت + التعديلات اليدوية − المدفوعات). فلا حدّ أعلى للمبلغ.

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

  // أ-٥/٢ · شقُّ تحويلٍ (كلّي↔ماستر): يُحذَف الزوجُ معاً — حذفُ شقٍّ وحدَه يترك مالاً
  // خرج من دفترٍ ولم يدخل الآخر. والعلامةُ «زوج #N» في الملاحظة، والشقُّ الآخرُ يُقبَل
  // حذفُه فقط إن كان يشير إلينا بالمثل (تبادلٌ يقطع الالتباس) — وضمن نفس الوكيل حصراً.
  const row = await prisma.managerTx.findFirst({ where: { id, isDeleted: false, agentId }, select: { id: true, notes: true } });
  if (!row) return NextResponse.json({ ok: true }); // محذوفٌ سلفاً أو ليس لوكيلك — لا شيءَ يُفعل
  const pairId = Number(row.notes?.match(/زوج #(\d+)/)?.[1] ?? NaN);
  if (Number.isFinite(pairId)) {
    const other = await prisma.managerTx.findFirst({ where: { id: pairId, isDeleted: false, agentId }, select: { id: true, notes: true } });
    const mutual = other && Number(other.notes?.match(/زوج #(\d+)/)?.[1] ?? NaN) === row.id;
    if (mutual) {
      await prisma.managerTx.updateMany({ where: { id: { in: [row.id, other.id] }, agentId }, data: { isDeleted: true } });
      return NextResponse.json({ ok: true, pairDeleted: other.id });
    }
  }

  await prisma.managerTx.updateMany({ where: { id, isDeleted: false, agentId }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
