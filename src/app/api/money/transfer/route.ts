import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// ═════════ أ-٥ · الموضع ١: تحويلُ **مبلغٍ** بين النقديّ والماستر في التقرير اليوميّ ═════════
//
// طلبُ محمد: «بالضغط على المجموع (الماستر أو الكلّي) تظهر التفاصيل، ويظهر أسفلها "تحويل":
//  مبلغٌ يُحوَّل من النقديّ إلى الماستر ⇒ يزيد تقريرُ الماستر اليوميّ وينقص النقديّ — والعكس.»
//
// 🔑 والبنيةُ **صفّان مزدوجان** في `money_tx` (مواصفةُ البند بالحرف): خروجٌ من دفترٍ ودخولٌ
//   في الآخر، **بمؤشّرَين متبادلَين** (`sourceId` كلٍّ منهما يحمل معرّفَ الآخر) فيُحذفان معاً
//   دفعةً واحدة من مسار الإبطال — لا يبقى نصفُ تحويلٍ أبداً.
//
// ⚠️ وجهةُ الماستر تحمل `sourceType: "master"` **حتماً** — فمعنى الماستر معرَّفٌ في
//   `moneyKinds.ts` وحدَه (MASTER_SOURCE_TYPES) ولا يُخترع نوعٌ جديدٌ خارجَه وإلّا اختفى
//   المبلغ من كلّ الشاشات (حادثة الصياغات الأربع — تدقيق 2026-08-04). وجهةُ النقد تحمل
//   `sourceType: "transfer"` — ليس من أنواع الماستر فيُحسب في الصندوق، وليس من الأنواع
//   ذات السطر الخاصّ فيظهر قبضُه في «المقبوضات (اليوم)» وصرفُه في «المصروفات».

const schema = z.object({
  // لا كسورَ في الدينار العراقيّ (قاعدة ب-٠٠ عند كلّ مدخل مال)
  amount: z.coerce.number().int("المبلغ يجب أن يكون عدداً صحيحاً — لا كسور في الدينار العراقي").positive("المبلغ يجب أن يكون أكبر من صفر"),
  toMaster: z.boolean(), // true = نقديّ ← ماستر · false = ماستر ← نقديّ
  towerId: z.coerce.number().nullable().optional(),
});

export async function POST(request: Request) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { amount, toMaster } = parsed.data;

  // نسبةُ المكتب — نفسُ سلّم مسار القيد اليدويّ: المكتبُ المطلوب (إن كان من مكاتب الوكيل)،
  // وإلّا مكتبُ جلسة المستخدم، وإلّا مكتبُ الوكيل الوحيد. وقيدٌ بلا مكتبٍ لا يظهر في تقرير.
  const agentTowers = await agentTowerIds(session);
  let towerId: number | null = null;
  if (parsed.data.towerId != null) {
    if (!agentTowers.includes(parsed.data.towerId)) {
      return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
    }
    towerId = parsed.data.towerId;
  }
  if (towerId == null) towerId = session?.towerId ?? null;
  if (towerId == null && agentTowers.length === 1) towerId = agentTowers[0];
  if (towerId == null) {
    return NextResponse.json(
      { error: "اختر مكتباً من تبويبات المكاتب أولاً — التحويل يُنسب لمكتبٍ واحدٍ ليظهر في تقريره" },
      { status: 400 },
    );
  }

  const now = new Date();
  const result = await prisma.$transaction(async (t) => {
    // جهةُ النقد: خروجٌ عند التحويل إلى الماستر، ودخولٌ عند العكس
    const cash = await t.moneyTx.create({
      data: {
        moneyIn: toMaster ? 0 : amount,
        moneyOut: toMaster ? amount : 0,
        sourceType: "transfer", towerId, userId: session?.userId,
        date: now, serverDate: now,
        notes: toMaster ? "⇄ تحويل إلى الماستر" : "⇄ تحويل من الماستر",
      },
    });
    // جهةُ الماستر: عكسُ الاتّجاه بنفس المبلغ — و`sourceId` يشير إلى شقّه النقديّ
    const master = await t.moneyTx.create({
      data: {
        moneyIn: toMaster ? amount : 0,
        moneyOut: toMaster ? 0 : amount,
        sourceType: "master", sourceId: cash.id, towerId, userId: session?.userId,
        date: now, serverDate: now,
        notes: toMaster ? "⇄ تحويل من النقدي" : "⇄ تحويل إلى النقدي",
      },
    });
    // المؤشّرُ المتبادل: كلٌّ يعرف شقَّه — وهو علامةُ الزوج التي يُحذفان بها معاً
    await t.moneyTx.update({ where: { id: cash.id }, data: { sourceId: master.id } });
    await t.auditLog.create({
      data: {
        userId: session?.userId, action: "TRANSFER_CASH_MASTER", entity: "moneyTx", entityId: String(cash.id),
        details: `تحويل ${amount} ${toMaster ? "من النقدي إلى الماستر" : "من الماستر إلى النقدي"}` +
                 ` — مكتب #${towerId} — الزوج #${cash.id}/#${master.id}` +
                 ` — ⚖️ مجموعُ (الصندوق + الماستر) لم يتغيّر، وتوزيعُه تغيّر`,
      },
    });
    return { cashId: cash.id, masterId: master.id };
  });

  return NextResponse.json({
    ok: true, ...result,
    message: toMaster
      ? `حُوِّل ${amount.toLocaleString("en-US")} من النقدي إلى الماستر`
      : `حُوِّل ${amount.toLocaleString("en-US")} من الماستر إلى النقدي`,
  }, { status: 201 });
}
