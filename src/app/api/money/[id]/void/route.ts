import { NextResponse } from "next/server";
import { reverseInvoiceStock } from "@/lib/invoiceReverse";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { reverseRewardGrant } from "@/lib/rewards";

// حذف حركة مالية عكسياً من الصندوق.
// تسديد دين → يُرجَع الدين للمشترك. حركة يدوية → تُحذف فقط.
// حركة تفعيل/فاتورة → تُحذف من صفحة الوصولات/الفواتير (لإرجاع الأيام/المخزون كاملاً).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const session = await getSession();
  const reverse = (await request.json().catch(() => ({})))?.reverse !== false; // افتراضي true

  const { id } = await params;
  const txId = Number(id);

  const tx = await prisma.moneyTx.findUnique({ where: { id: txId } });
  if (!tx || tx.isDeleted || !(await ownsTower(g.session, tx.towerId))) {
    return NextResponse.json({ error: "الحركة غير موجودة أو محذوفة مسبقاً" }, { status: 404 });
  }

  // ═════ أ-٥/١ · زوجُ تحويلٍ نقديّ↔ماستر: يُحذَف الشقّان معاً دفعةً واحدة ═════
  // العلامةُ مؤشّران متبادلان: `sourceId` كلِّ شقٍّ يحمل معرّفَ الآخر — وهي قاطعةٌ فلا
  // تلتبس بماستر تفعيلٍ يحمل في `sourceId` رقمَ وصلٍ صادف رقمَ حركة. وحذفُ شقٍّ واحدٍ
  // يترك نصفَ تحويلٍ (مالٌ نقص من دفترٍ ولم يدخل الآخر) — فلا يُتاح أصلاً.
  if (tx.sourceId != null && (tx.sourceType === "transfer" || tx.sourceType === "master")) {
    const other = await prisma.moneyTx.findUnique({ where: { id: tx.sourceId } });
    const isPair = other && !other.isDeleted && other.sourceId === tx.id &&
      ((tx.sourceType === "transfer" && other.sourceType === "master") ||
       (tx.sourceType === "master" && other.sourceType === "transfer"));
    if (isPair) {
      await prisma.$transaction([
        prisma.moneyTx.updateMany({ where: { id: { in: [tx.id, other.id] }, isDeleted: false }, data: { isDeleted: true } }),
        prisma.auditLog.create({
          data: {
            userId: session?.userId, action: "VOID_MONEY", entity: "moneyTx", entityId: String(tx.id),
            details: `حذف زوج تحويل نقدي↔ماستر #${tx.id}/#${other.id} — المبلغ ${(tx.moneyIn || tx.moneyOut) ?? 0} عاد إلى دفتره`,
          },
        }),
      ]);
      return NextResponse.json({ ok: true, pairDeleted: other.id });
    }
  }

  // حركة ماستر **مرتبطة بوصل** (تفعيل أو فاتورة): حذفها وحدها يمحو الجزء الماستر
  // ويترك الوصل قائماً بمبلغ لا يقابله مال — فيبقى وصلٌ يزعم قبضاً لم يعد موجوداً.
  // الحذف الصحيح من الوصل نفسه، فهو يعكس الأيام والكارت والدين والماستر معاً.
  // (المرحلة ١٠ — الماستر اليدوي بلا sourceId يُحذف من هنا عادياً.)
  if ((tx.sourceType === "master" || tx.sourceType === "master-invoice") && tx.sourceId) {
    return NextResponse.json(
      {
        error:
          tx.sourceType === "master"
            ? "هذه حركة ماستر تخصّ وصل تفعيل — احذف الوصل نفسه من «سجل الوصولات» ليُعكس كل أثره معاً (الأيام والكارت والدين والماستر)."
            : "هذه حركة ماستر تخصّ فاتورة — احذف الفاتورة نفسها من «سجل وصولات المبيع» ليُعكس كل أثرها معاً.",
      },
      { status: 400 },
    );
  }

  // ═════ 🔴 حرِجة ١ · حركةُ تسديد مكتبٍ (office-settle) — تُرفَض، تُرجَع من شاشتها ═════
  // (اصطاده الفحصُ العدائيّ 2026-08-19.) حركةُ التسديد تحمل **وسمَ settledTxId على قيودٍ
  // كثيرة**. وحذفُها من هنا يسقط إلى الحذف الأعمى (أسفلُ الملفّ) الذي يمحو الحركةَ **ويترك**
  // القيودَ موسومةً «مسدَّدة» بمؤشّرٍ لحركةٍ محذوفة ⇒ الدَّينُ لا يعود للظهور (قائمةُ الدَّين
  // تُرشِّح settledAt: null) والمالُ اختفى من الصندوق — يتبخّر الطرفان معاً.
  // 🔑 والإرجاعُ الصحيحُ من شاشة التسديد («إرجاع القيود») فهو يرفع الوسمَ عن القيود ثمّ يُنقص
  //    حركةَ التسديد **معاً** في معاملةٍ واحدة (settlements/route.ts). فيُوجَّه المستخدمُ إليه.
  // 🔒 العزلُ محفوظ: فُحص `ownsTower(tx.towerId)` أعلاه، والرفضُ لا يمسّ بياناتٍ أصلاً.
  if (tx.sourceType === "office-settle") {
    return NextResponse.json(
      { error: "هذه حركةُ تسديدِ مكتبٍ — لا تُحذف من هنا (يبقى الدَّينُ موسوماً «مسدَّداً» بلا مال). أرجِعْها من زرّ «إرجاع القيود» في شاشة تسديد المكاتب ليُرفَع الوسمُ ويُعاد الدَّينُ معاً." },
      { status: 400 },
    );
  }

  // أثرُ إرجاعِ البضاعة — يُسجَّل في التدقيق فيُقرَأ لاحقاً بلا تخمين


  let reversedStock: { lines: number; qty: number } | null = null;


  try {
    await prisma.$transaction(async (t) => {
     if (reverse) {
      // ===== حركة تفعيل: إرجاع كامل (أيام + كارت + دين) ثم حذف الوصل =====
      if (tx.sourceType === "activation" && tx.sourceId) {
        const entry = await t.subscriptionEntry.findUnique({ where: { id: tx.sourceId } });
        if (entry && !entry.isDeleted) {
          if (entry.subscriberId) {
            const sub = await t.subscriber.findUnique({ where: { id: entry.subscriberId } });
            if (sub) {
              const debtAdded = (entry.money ?? 0) + (entry.addPrice ?? 0) - (entry.moneyIn ?? 0);
              const restoredDateTo = entry.dateFrom && entry.dateFrom > new Date() ? entry.dateFrom : null;
              await t.subscriber.update({
                where: { id: sub.id },
                data: { dateTo: restoredDateTo, carry: (sub.carry ?? 0) - debtAdded },
              });
            }
          }
          // إرجاع الكارت للمخزون
          if (entry.card2 && entry.subscriberId) {
            await t.rechargeCard.updateMany({
              where: { serial: entry.card2, subscriberId: entry.subscriberId, useDate: { not: null } },
              data: { useDate: null, subscriberId: null, userName: null },
            });
          }
          // عكس مكافأة هذا التفعيل — كان ناقصاً هنا بينما مسار «سجل وصولات المشترك»
          // يعكسها، فحذف الوصل من الصندوق كان يترك الخصم ممنوحاً بلا وصل (حادثة
          // علي سهيل 2026-08-04: منحتان 1,500 لتفعيل واحد أُعيد تسجيله).
          if (entry.subscriberId) {
            await reverseRewardGrant(t, {
              entryId: entry.id, subscriberId: entry.subscriberId, towerId: entry.towerId,
              agentId: g.session?.agentId ?? null, createdByUser: session?.username, createdByName: session?.fullName,
            });
          }
          await t.subscriptionEntry.update({ where: { id: entry.id }, data: { isDeleted: true } });
        }
      }

      // ===== حركة فاتورة: حذف الفاتورة **وإرجاع بضاعتها للمخزن** =====
      // 🔴 **علّةٌ مقيسةٌ على الإنتاج (2026-08-14)**: كان هذا السطرُ يحذف الفاتورةَ وحدَها،
      //   فتُمحى الورقةُ ويبقى **المخزنُ ناقصاً** وبنودُها حيّةً بلا فاتورة. وقِيس أثرُها:
      //   بندانِ حيّانِ في فاتورةٍ محذوفةٍ وقطعتانِ لم ترجعا للرفّ.
      //   وهي حالةُ محمد بالحرف: «حُذفت قطعةٌ من مادةٍ في المبيعات» — فلا هي مبيعةٌ
      //   ولا هي في المخزن. والعلاجُ بنفسِ دالّةِ إبطالِ الفاتورة فلا يتفرّق المسارانِ ثانيةً.
      if (tx.sourceType === "invoice" && tx.sourceId) {
        const inv = await t.invoice.findUnique({ where: { id: tx.sourceId }, select: { isDeleted: true } });
        if (inv && !inv.isDeleted) {
          const back = await reverseInvoiceStock(t, tx.sourceId);
          if (back.lines > 0) reversedStock = back;
        }
        await t.invoice.updateMany({ where: { id: tx.sourceId, isDeleted: false }, data: { isDeleted: true } });
      }

      // ===== تسديد دين (نقدي أو ماستر): أرجِع المبلغ ديناً على المشترك =====
      if ((tx.sourceType === "debt" || tx.sourceType === "master-debt") && tx.sourceId) {
        const sub = await t.subscriber.findUnique({ where: { id: tx.sourceId } });
        if (sub) {
          await t.subscriber.update({ where: { id: sub.id }, data: { carry: (sub.carry ?? 0) + (tx.moneyIn ?? 0) } });
        }
      }

      // ===== بيع من المخزن: أرجِع الكمية إلى المادة (المرحلة ١٠) =====
      // كان المال يعود والبضاعة لا تعود — بخلاف الفاتورة التي تُرجع كمياتها عند
      // إبطالها. البيع من المخزن أُلغي كميزة، لكن حركاته القديمة ما تزال تُحذف.
      // الكمية تُستخرج من نص الملاحظة («بيع {اسم} × {عدد} بسعر …») لأن الحركة لا
      // تحمل حقل كمية — وإن تعذّر استخراجها لا نُخمّن.
      if (tx.sourceType === "sale" && tx.sourceId) {
        const qty = Number(tx.notes?.match(/×\s*(\d+(?:\.\d+)?)/)?.[1] ?? NaN);
        if (Number.isFinite(qty) && qty > 0) {
          await t.item.updateMany({ where: { id: tx.sourceId }, data: { count: { increment: qty } } });
        }
      }
     } // نهاية كتلة الإرجاع العكسي (reverse): بلا إرجاع لا نمسّ التفعيل/الفاتورة/الدين

      // ===== حذف الحركة نفسها (يشمل: بيع، ماستر، نثرية، يدوية) — يتم دائماً =====
      await t.moneyTx.update({ where: { id: txId }, data: { isDeleted: true } });
      await t.auditLog.create({
        data: {
          userId: session?.userId, action: "VOID_MONEY", entity: "moneyTx", entityId: String(txId),
          details: `حذف حركة (${tx.sourceType ?? "يدوية"}) ${reverse ? "عكسياً" : "بلا تأثير"} - قبض ${tx.moneyIn ?? 0} - صرف ${tx.moneyOut ?? 0}`,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف الحركة" }, { status: 500 });
  }
}
