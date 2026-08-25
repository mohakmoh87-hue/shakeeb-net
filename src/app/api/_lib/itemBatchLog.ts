import { prisma } from "@/lib/prisma";

// ═════ 📦 سجلُّ دفعات المادة — سؤالُ محمد 2026-08-25 ═════
//
// بنصّه: «عند الدخول إلى المخزن من أجل إضافة مادة يمكنني زيادةُ عدد المواد من نفس المادة،
// ولكن سعرَ الشراء قد يختلف لنفس المادة في وقتٍ لاحق — كيف سيميّز ذلك؟ وكيف سأعرف سعرَ
// شراء المادة في كلّ مرّةٍ أزيد العدد؟»
//
// 🔴 والجوابُ قبل هذا الملفّ كان: **لا يميّز، ولن تعرف**. المادةُ صفٌّ واحدٌ (`items`)
//   بكلفةٍ واحدة `priceDinar`: المستخدمُ العاديُّ يزيد الكميّةَ وحدَها فتبقى كلفةُ أوّل
//   دفعةٍ إلى الأبد، والمديرُ إن كتب كلفةً جديدةً **مُحيت القديمةُ بلا أثر**. وسجلُّ
//   التدقيق كان يحفظ الكميّةَ ولا يذكر السعرَ ولا مرّة.
//
// 🎯 **وقرارُ محمد: سجلٌّ للقراءة وحدَه** — لا متوسّطٌ مرجّح ولا FIFO. فحسابُ الربح
//   ومسارُ البيع و`priceDinar` **لا يُمَسّ منها شيء**، والمكسبُ معرفةٌ لا حساب.
//
// 🔑 **ولماذا `audit_logs` لا جدولٌ جديد؟** سببان:
//   ① بلا لصقةِ SQL: الجدولُ قائمٌ **ولا يُمحى أبداً** (لا مُنظِّفَ له في البرنامج كلِّه).
//   ② **والتاريخُ القديم يظهر فوراً**: كلُّ زيادةِ كميّةٍ منذ 2026-08-05 مسجَّلةٌ فيه
//      أصلاً (كم · متى · بيد من) — الناقصُ السعرُ وحدَه. فبجدولٍ جديدٍ كانت الصفحةُ
//      تُفتَح فارغةً وتُبنى الذاكرةُ من الصفر.

/** وسمٌ آليُّ القراءة يُلحَق بنصّ الأثر — بمحدِّداتٍ لا ترد في أسماء الناس ولا المواد. */
const TAG_RE = /⟦q:(-?\d+(?:\.\d+)?)→(-?\d+(?:\.\d+)?)(?:\|buy:(-?\d+(?:\.\d+)?))?⟧/;

/** يبني الوسمَ الذي يُلحَق بتفصيل الأثر عند كلّ تغييرِ كميّة. */
export function batchTag(before: number, after: number, buyPrice?: number | null): string {
  const p = buyPrice != null && Number.isFinite(buyPrice) && buyPrice > 0 ? `|buy:${Math.round(buyPrice)}` : "";
  return ` ⟦q:${before}→${after}${p}⟧`;
}

export type BatchRow = {
  id: number;
  at: Date;
  user: string;
  before: number;
  after: number;
  delta: number;
  /** سعرُ شراء هذه الدفعة — `null` لصفوفٍ قديمةٍ سُجّلت قبل الميزة (لا تُلفَّق) */
  buyPrice: number | null;
};

/**
 * قراءةُ سجلّ دفعات مادةٍ واحدة.
 * 🔒 **العزلُ مسؤوليّةُ النداء**: هذه الدالّةُ لا تعرف الجلسةَ، فيجب أن يكون المُنادي قد
 *    تحقّق أنّ المادةَ من مكاتب الوكيل (`ownsTower`) قبل استدعائها.
 */
export async function readItemBatches(itemId: number, take = 200): Promise<BatchRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entity: "item", entityId: String(itemId), action: { in: ["ITEM_QTY_UP", "ITEM_QTY_DOWN"] } },
    orderBy: { id: "desc" },
    take,
    select: { id: true, createdAt: true, details: true, user: { select: { fullName: true, username: true } } },
  }).catch(() => []);

  return rows.map((r) => {
    const d = r.details ?? "";
    const m = TAG_RE.exec(d);
    // 🔁 ارتدادٌ للصفوف القديمة: نصُّها ثابتُ الصيغة («… من 20 إلى 50 …») فتُقرأ منه
    //    الكميّاتُ ويبقى السعرُ `null` صراحةً — **لا يُخمَّن ولا يُملأ بالكلفة الحاليّة**،
    //    فسجلٌّ يكذب أسوأُ من سجلٍّ ناقص.
    const alt = m ? null : /من (-?\d+(?:\.\d+)?) إلى (-?\d+(?:\.\d+)?)/.exec(d);
    const before = Number(m?.[1] ?? alt?.[1] ?? 0);
    const after = Number(m?.[2] ?? alt?.[2] ?? 0);
    const buy = m?.[3] != null ? Number(m[3]) : null;
    return {
      id: r.id,
      at: r.createdAt,
      user: (r.user?.fullName ?? r.user?.username ?? "—").trim() || "—",
      before, after, delta: after - before,
      buyPrice: buy != null && Number.isFinite(buy) ? buy : null,
    };
  });
}
