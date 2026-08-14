import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { MASTER_SOURCE_TYPES } from "@/lib/moneyKinds";

// ═════════ أ-٥ · الموضع ٣: تحويلُ وصلٍ قائمٍ بين **الماستر والنقديّ** ═════════
//
// طلبُ محمد (مؤكَّدٌ 2026-08-14): «طلبتُ منك تحويلَ وصلِ مشتركٍ موجودٍ من ماستر إلى
//  نقديّ وبالعكس… لكن لم أرَ ذلك يُطبَّق». وهو صحيح: البندُ موصوفٌ في البنود ولم يُبنَ.
//
// 🔑 **والتحويلُ تبديلُ نوعٍ لا حركةٌ جديدة**: صفُّ الصندوق نفسُه يبقى بمبلغه وتاريخه
//   ومصدره، ويُبدَّل `sourceType` وحدَه:
//     `activation` ⇄ `master` · `invoice` ⇄ `master-invoice` · `debt` ⇄ `master-debt`
//   فلا يُنشأ مالٌ ولا يُمحى — يُنقَل من دفترٍ إلى دفتر. وهذا ما يجعله آمناً:
//   **مجموعُ المال الكلّيّ لا يتغيّر**، ويتغيّر توزيعُه بين الماستر والصندوق فقط.
//
// ⚠️ ومعنى «الماستر» يُقرَأ من `moneyKinds.ts` **حصراً** — لا قوائمَ يدويّة. فقد سبقت
//   حادثةُ أربعِ صياغاتٍ متفرّقةٍ عُدَّ فيها مالُ فاتورة الماستر مرّتَين (تدقيق 2026-08-04)،
//   وبناءُ التحويل على قائمةٍ محلّيّةٍ يُعيدها.
//
// 🔒 والعزل: الصفُّ من مكتبٍ يملكه وكيلُ الجلسة (`ownsTower`) أو لا شيء.

/** خرائطُ التبديل — ذهاباً وعودةً، مبنيّةٌ على التعريف الواحد. */
const TO_MASTER: Record<string, string> = {
  activation: "master",
  invoice: "master-invoice",
  debt: "master-debt",
};
const TO_CASH: Record<string, string> = Object.fromEntries(
  Object.entries(TO_MASTER).map(([cash, master]) => [master, cash]),
);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("receipts.void"); // مَن يملك إبطالَ وصلٍ يملك تحويلَ نوعه
  if (g.error) return g.error;

  const { id } = await params;
  const txId = Number(id);
  const tx = await prisma.moneyTx.findUnique({ where: { id: txId } });
  if (!tx || tx.isDeleted || !(await ownsTower(g.session, tx.towerId))) {
    return NextResponse.json({ error: "الحركة غير موجودة أو محذوفة" }, { status: 404 });
  }

  const cur = tx.sourceType ?? "";
  const isMaster = (MASTER_SOURCE_TYPES as readonly string[]).includes(cur);
  const next = isMaster ? TO_CASH[cur] : TO_MASTER[cur];
  if (!next) {
    // ⚠️ ولا تُخمَّن نيّةُ المستخدم: حركةٌ يدويّةٌ (بلا `sourceType`) أو من نوعٍ لا مقابلَ
    //   له تُرفَض بنصٍّ يشرح، لا تُحوَّل إلى شيءٍ عشوائيّ.
    return NextResponse.json({
      error: cur
        ? `لا مقابلَ ماستر/نقديٍّ للنوع «${cur}» — التحويلُ للتفعيل والفاتورة وتسديد الدَّين فقط.`
        : "هذه حركةٌ يدويّةٌ بلا نوع، فلا تُحوَّل. أبطِلها وسجّلها على الوجه الصحيح.",
    }, { status: 400 });
  }

  // ═══ التبديلُ الذرّيّ: شرطُ النوع الحاليِّ في `updateMany` يمنع تحويلاً مزدوجاً ═══
  // (ضغطتان متتاليتان أو نافذتان مفتوحتان ⇒ الثانيةُ تجد النوعَ قد تغيّر فلا تفعل شيئاً)
  const claimed = await prisma.moneyTx.updateMany({
    where: { id: txId, sourceType: cur, isDeleted: false },
    data: { sourceType: next },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "تغيّر نوعُ الحركة قبل التحويل — أعِد تحميلَ الصفحة" }, { status: 409 });
  }

  // وفاتورةُ الماستر لها صفٌّ ثانٍ أحياناً (مختلطة) — يُحوَّل معها كي لا يتفرّق الوصل
  let siblings = 0;
  if (tx.sourceId != null && (cur === "invoice" || cur === "master-invoice")) {
    const sib = await prisma.moneyTx.updateMany({
      where: { id: { not: txId }, sourceId: tx.sourceId, sourceType: cur, isDeleted: false, towerId: tx.towerId },
      data: { sourceType: next },
    });
    siblings = sib.count;
  }

  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId, action: "CONVERT_MONEY_KIND", entity: "moneyTx", entityId: String(txId),
      details: `تحويلُ وصلٍ من «${cur}» إلى «${next}» — قبض ${tx.moneyIn ?? 0} · صرف ${tx.moneyOut ?? 0}` +
               ` — مصدرُه #${tx.sourceId ?? "—"}${siblings ? ` — ومعه ${siblings} صفّاً مرافقاً` : ""}` +
               ` — ⚖️ المجموعُ الكلّيُّ لم يتغيّر، والتوزيعُ بين الماستر والصندوق تغيّر`,
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true, from: cur, to: next, siblings,
    toMaster: !isMaster,
    message: isMaster ? "حُوِّل الوصلُ إلى **نقديّ** — دخل الصندوقَ وخرج من الماستر"
                      : "حُوِّل الوصلُ إلى **ماستر** — خرج من الصندوق ودخل الماستر",
  });
}
