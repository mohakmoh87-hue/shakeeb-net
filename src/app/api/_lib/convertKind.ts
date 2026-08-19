import { prisma } from "@/lib/prisma";
import { MASTER_SOURCE_TYPES } from "@/lib/moneyKinds";

// ═════ أ-٥/٣ · تحويلُ وصلٍ قائمٍ بين الماستر والنقديّ — **بكلّ أثره** ═════
//
// 🔴 وعلّةٌ اصطادها سؤالُ محمد (2026-08-14): «أين ذهب التحويل من سجلّ المشترك؟» — وعند
//   الفحص تبيّن أنّ التحويلَ المنشورَ يُبدّل `money_tx.sourceType` **وحدَه**، بينما التقريرُ
//   اليوميُّ يَعُدُّ التفعيلاتِ من `subscription_entries.isMaster` والفواتيرَ من `invoices.type`.
//   ⇒ وصلٌ حُوِّل إلى ماستر كان **يُحسَب مرّتين**: مالُه يظهر في سطر «تفعيل اشتراكات»
//   (لأنّ القيدَ ما زال `isMaster=false`) **وفي سطر الماستر** معاً — وهي بعينها حادثةُ
//   «عُدَّ المالُ مرّتين» التي وُلد منها `moneyKinds.ts` (تدقيق 2026-08-04).
//
// ⇒ فالتحويلُ يمسّ **الطرفين معاً وفي معاملةٍ واحدة**: حركةَ الصندوق ووسمَ مصدرها.
//   والمجموعُ الكلّيُّ (صندوق + ماستر) لا يتغيّر أبداً — نقلُ دفترٍ لا خلقُ مال.

/** خرائطُ التبديل — ذهاباً وعودةً، مبنيّةٌ على التعريف الواحد. */
const TO_MASTER: Record<string, string> = {
  activation: "master",
  invoice: "master-invoice",
  debt: "master-debt",
};
const TO_CASH: Record<string, string> = Object.fromEntries(
  Object.entries(TO_MASTER).map(([cash, master]) => [master, cash]), // العودةُ تُبنى بالعكسِ آليّاً فلا تتفرّق الخريطتان
);

export type ConvertResult =
  | { ok: true; from: string; to: string; toMaster: boolean; siblings: number; stamped: string | null; message: string }
  | { ok: false; status: number; error: string };

/**
 * يُحوّل حركةَ صندوقٍ بين الماستر والنقديّ **ومعها وسمُ مصدرها**.
 * 🔒 الملكيّةُ تُفحَص في المسار المُنادي (`ownsTower`) قبل النداء — هذه الدالّةُ تنفّذ لا تحرس.
 */
export async function convertMoneyKind(txId: number, userId: number | undefined): Promise<ConvertResult> {
  const tx = await prisma.moneyTx.findUnique({ where: { id: txId } });
  if (!tx || tx.isDeleted) return { ok: false, status: 404, error: "الحركة غير موجودة أو محذوفة" };

  const cur = tx.sourceType ?? "";
  const isMaster = (MASTER_SOURCE_TYPES as readonly string[]).includes(cur);
  const next = isMaster ? TO_CASH[cur] : TO_MASTER[cur];
  if (!next) {
    return {
      ok: false, status: 400,
      error: cur
        ? `لا مقابلَ ماستر/نقديٍّ للنوع «${cur}» — التحويلُ للتفعيل والفاتورة وتسديد الدَّين فقط.`
        : "هذه حركةٌ يدويّةٌ بلا نوع، فلا تُحوَّل. أبطِلها وسجّلها على الوجه الصحيح.",
    };
  }
  const toMaster = !isMaster;

  // ═════ 🔴 حرِجة ٤ · شقُّ زوجِ التحويل (نقديّ↔ماستر) لا يُحوَّل (اصطاده الفحصُ العدائيّ 2026-08-19) ═════
  // النوعُ «master» يخدم أمرَين: ماسترَ **تفعيلٍ** (sourceId → قيدُ اشتراك)، وشقَّ **زوجِ
  // تحويلٍ** في التقارير (sourceId → الحركةُ المقابلةُ، بمؤشّرَين متبادلَين). ولأنّ TO_CASH
  // ["master"]="activation" فإنّ تحويلَ شقِّ الزوج كان يمرّ: يُقلَب نوعُه، ثمّ (السطرُ 72،
  // cur==="master") يَسِمُ `subscriptionEntry` حيثُ id = sourceId = **معرّفُ الحركة المقابلة**
  // ⇒ يُقلَب قيدُ تفعيلٍ أجنبيٌّ صادفَ ذلك المعرّف، ويختفي المبلغُ من الماستر. فيُرفَض كالحذف.
  // 🔑 والتمييزُ قاطعٌ بالمؤشّر المتبادل (كما في مسار الحذف) فلا يلتبس بماستر تفعيلٍ حقيقيّ.
  if ((cur === "master" || cur === "transfer") && tx.sourceId != null) {
    const other = await prisma.moneyTx.findUnique({ where: { id: tx.sourceId } });
    const isTransferPair = other != null && !other.isDeleted && other.sourceId === tx.id &&
      ((cur === "master" && other.sourceType === "transfer") ||
       (cur === "transfer" && other.sourceType === "master"));
    if (isTransferPair) {
      return { ok: false, status: 400, error: "هذه حركةُ تحويلٍ نقديّ↔ماستر (زوجٌ) — لا تُحوَّل كوصل. أبطِلها من الصندوق ليُحذَف الزوجُ معاً." };
    }
  }

  let siblings = 0;
  let stamped: string | null = null;
  try {
    await prisma.$transaction(async (t) => {
      // ═══ التبديلُ الذرّيّ: شرطُ النوع الحاليِّ يمنع تحويلاً مزدوجاً (ضغطتان/نافذتان) ═══
      const claimed = await t.moneyTx.updateMany({
        where: { id: txId, sourceType: cur, isDeleted: false },
        data: { sourceType: next },
      });
      if (claimed.count !== 1) throw new Error("RACE");

      // وفاتورةُ الماستر لها صفٌّ ثانٍ أحياناً (مختلطة) — يُحوَّل معها كي لا يتفرّق الوصل
      if (tx.sourceId != null && (cur === "invoice" || cur === "master-invoice")) {
        const sib = await t.moneyTx.updateMany({
          where: { id: { not: txId }, sourceId: tx.sourceId, sourceType: cur, isDeleted: false, towerId: tx.towerId },
          data: { sourceType: next },
        });
        siblings = sib.count;
      }

      // 🔑 **وسمُ المصدر** — بلا هذا يُعَدُّ المالُ مرّتين في التقرير اليوميّ
      if (tx.sourceId != null && (cur === "activation" || cur === "master")) {
        const e = await t.subscriptionEntry.updateMany({
          where: { id: tx.sourceId, isDeleted: false },
          data: { isMaster: toMaster },
        });
        if (e.count) stamped = `قيدُ التفعيل #${tx.sourceId} صار ${toMaster ? "ماستر" : "عاديّاً"}`;
      }
      if (tx.sourceId != null && (cur === "invoice" || cur === "master-invoice")) {
        // فاتورةُ الماستر تُعرَف بـ`type = "ماستر"` في التقرير — والعودةُ تُفرّغه فتعود للتقرير
        const inv = await t.invoice.findUnique({ where: { id: tx.sourceId }, select: { type: true, isDeleted: true } });
        if (inv && !inv.isDeleted) {
          await t.invoice.update({ where: { id: tx.sourceId }, data: { type: toMaster ? "ماستر" : null } });
          stamped = `الفاتورة #${tx.sourceId}: النوعُ «${inv.type ?? "—"}» ← «${toMaster ? "ماستر" : "—"}»`;
        }
      }

      await t.auditLog.create({
        data: {
          userId, action: "CONVERT_MONEY_KIND", entity: "moneyTx", entityId: String(txId),
          details: `تحويلُ وصلٍ من «${cur}» إلى «${next}» — قبض ${tx.moneyIn ?? 0} · صرف ${tx.moneyOut ?? 0}` +
                   ` — مصدرُه #${tx.sourceId ?? "—"}${siblings ? ` — ومعه ${siblings} صفّاً مرافقاً` : ""}` +
                   `${stamped ? ` — ${stamped}` : ""}` +
                   ` — ⚖️ المجموعُ الكلّيُّ لم يتغيّر، والتوزيعُ بين الماستر والصندوق تغيّر`,
        },
      });
    });
  } catch (e) {
    if ((e as Error).message === "RACE") {
      return { ok: false, status: 409, error: "تغيّر نوعُ الحركة قبل التحويل — أعِد تحميلَ الصفحة" };
    }
    return { ok: false, status: 500, error: "تعذّر التحويل" };
  }

  return {
    ok: true, from: cur, to: next, toMaster, siblings, stamped,
    message: toMaster ? "حُوِّل الوصلُ إلى **ماستر** — خرج من الصندوق ودخل الماستر"
                      : "حُوِّل الوصلُ إلى **نقديّ** — دخل الصندوقَ وخرج من الماستر",
  };
}
