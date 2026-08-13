import { prisma } from "@/lib/prisma";

// ===== «مِن أين جاء هذا الرقم» — صاحبُ كلّ حركةٍ ماليّة (طلب محمد 2026-08-13) =====
// «هذه الخيارات يجب أن أستطيع الضغط عليها لمشاهدة تفاصيلَ من أين أتت كلُّ واحدةٍ بالتفصيل
//  الكامل… أريد اليوزر والاسم معاً ووقت تفعيله بالساعة والدقيقة والثانية.»
//
// وكانت الملاحظةُ وحدَها هي كلُّ ما يُعرَف عن الحركة، وفيها الاسمُ مقتطعاً بلا يوزر:
//   'تسديد دين - عدنان عبد الرضا ابو الهيل مط'   ← الاسمُ مقصوصٌ عند ٤٠ حرفاً
// فلا يُعرَف أيُّ مشتركٍ هو حين يتشابه الاسمان، ولا يُبحَث عنه بيوزره. وهذه الدالّةُ تُرجع
// المشتركَ **من مفتاحه** لا من نصِّ الملاحظة.
//
// 🔑 والمسالكُ الثلاثةُ مُثبَتةٌ على بيانات الإنتاج (2026-08-13) — لا مُخمَّنة:
//   activation · master        → sourceId = subscription_entries.id → subscriberId
//   invoice · sale · master-invoice → sourceId = invoices.id        → subscriberId
//   debt · master-debt         → sourceId = subscribers.id **مباشرةً**
//   manual (و sourceId فارغ)   → لا صاحبَ له، وهذا صحيح (سحبٌ/خصمٌ يدويّ)
//
// ⚠️ العزل: هذه الدالّةُ **لا تُرشِّح بنفسها** — تأخذ حركاتٍ **مُقيَّدةً بمكاتب الوكيل مسبقاً**
// من المسار الذي يُناديها، فلا تُستدعى أبداً بمُعرَّفاتٍ آتيةٍ من المستخدم مباشرةً.

export type TxSubject = { name: string | null; netUser: string | null; subscriberId: number | null };
type TxLike = { id: number; sourceType: string | null; sourceId: number | null };

const ENTRY_TYPES = new Set(["activation", "master"]);
const INVOICE_TYPES = new Set(["invoice", "sale", "master-invoice"]);
const SUB_TYPES = new Set(["debt", "master-debt"]);

/** يُرجع خريطة: معرّفُ الحركة → صاحبُها (اسم + يوزر). الحركاتُ بلا صاحبٍ لا تظهر في الخريطة. */
export async function subjectsForTxs(txs: TxLike[]): Promise<Map<number, TxSubject>> {
  const out = new Map<number, TxSubject>();
  const entryIds: number[] = [], invoiceIds: number[] = [], subIds: number[] = [];
  for (const t of txs) {
    if (t.sourceId == null || t.sourceType == null) continue;
    if (ENTRY_TYPES.has(t.sourceType)) entryIds.push(t.sourceId);
    else if (INVOICE_TYPES.has(t.sourceType)) invoiceIds.push(t.sourceId);
    else if (SUB_TYPES.has(t.sourceType)) subIds.push(t.sourceId);
  }
  if (!entryIds.length && !invoiceIds.length && !subIds.length) return out;

  // ثلاثةُ استعلاماتٍ مُجمَّعةٍ لا استعلامٌ لكلّ سطر (٥٠٠ سطرٍ × ٢ = ألفُ رحلةٍ إلى القاعدة)
  const [entries, invoices] = await Promise.all([
    entryIds.length
      ? prisma.subscriptionEntry.findMany({ where: { id: { in: [...new Set(entryIds)] } }, select: { id: true, subscriberId: true } })
      : Promise.resolve([]),
    invoiceIds.length
      ? prisma.invoice.findMany({ where: { id: { in: [...new Set(invoiceIds)] } }, select: { id: true, subscriberId: true, number: true } })
      : Promise.resolve([]),
  ]);

  const entrySub = new Map(entries.map((e) => [e.id, e.subscriberId]));
  const invSub = new Map(invoices.map((i) => [i.id, i.subscriberId]));
  const allSubIds = [...new Set([
    ...subIds,
    ...[...entrySub.values()].filter((x): x is number => x != null),
    ...[...invSub.values()].filter((x): x is number => x != null),
  ])];
  // المشتركُ الممسوحُ نهائيّاً (purgedAt) يبقى اسمُه كي تُقرأ وصولاتُه القديمة — فلا يُستثنى هنا
  const subs = allSubIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: allSubIds } }, select: { id: true, name: true, netUser: true } })
    : [];
  const subById = new Map(subs.map((s) => [s.id, s]));

  const put = (txId: number, subscriberId: number | null | undefined) => {
    if (subscriberId == null) return;
    const s = subById.get(subscriberId);
    if (!s) return;
    out.set(txId, { name: s.name ?? null, netUser: s.netUser ?? null, subscriberId: s.id });
  };

  for (const t of txs) {
    if (t.sourceId == null || t.sourceType == null) continue;
    if (ENTRY_TYPES.has(t.sourceType)) put(t.id, entrySub.get(t.sourceId));
    else if (INVOICE_TYPES.has(t.sourceType)) put(t.id, invSub.get(t.sourceId));
    else if (SUB_TYPES.has(t.sourceType)) put(t.id, t.sourceId);
  }
  return out;
}
