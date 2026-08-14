// ═════ 🔒 العمودُ الخاصُّ بتكليفات حارس المال (طلبُ محمد 2026-08-14) ═════
//
// نصُّ الطلب، ثلاثُ جملٍ متتابعة:
//   ١) «التكتُ عنوانُه **حالاتٌ حرجةٌ من المدير يجب اتّخاذُ إجراءٍ بها**، وعند فتحه
//      **لكلّ حالةٍ تظهر كاملُ تفاصيلها**.»
//   ٢) «**ولا يراها سوى المدير والفنيِّ المعنيِّ أو المديرِ المعنيّ.**»
//   ٣) «يجب إنشاءُ **عمودٍ خاصٍّ** بها، خاصيّتُه أن لا يُرى ما فيه إلّا من المدير أو من
//      الفنيّ المعنيّ. **والعمودُ يظهر فقط إذا فيه بطاقات**، وإذا خلا اختفى.»
//
// 🔑 والخاصيّةُ على **العمود** لا على البطاقة عن قصد: فبطاقةٌ تُنقَل إلى عمودٍ عامٍّ تصير
//   مرئيّةً، وأخرى تُضاف هنا تصير مكتومة — والقاعدةُ تتبع مكانَ البطاقة لا نوعَها.
//
// ⚠️ ومكمنُ الخطأ الذي يحرسه هذا الملفّ: خيارُ `ownCardsOnly` على الفنيّ **يُظهر لمن لا
//   يحمله كلَّ بطاقات اللوحة**. فبلا هذا الحجب كان تكليفُ فنيٍّ يُقرأ من زملائه كلِّهم.

/**
 * اسمُ العمود الخاصّ — واحدٌ في كلّ اللوحات، ويُقرأ في مسارِ اللوحة وفي التكليف.
 * وطلبُ محمد: «العمودُ اسمُه **حارس المال** ونفسُ الإيموجي عليه».
 * 👮 وهو أقربُ إيموجي إلى الشخصيّة المرسومة (ضابطٌ بقبّعةٍ ونظّارة) — فالرسمُ نفسُه
 *   متجهاتٌ في `GuardFigure` ولا يُوضَع في نصِّ عمود.
 */
export const GUARD_LIST_NAME = "👮 حارس المال";

export type BoardViewer =
  | { kind: "manager" } // مديرٌ (أو مالك) — يرى كلَّ شيء
  | { kind: "technician"; technicianId: number } // الفنيُّ — بطاقاتُه وحدَها من العمود الخاصّ
  | { kind: "user" }; // مستخدمُ مكتبٍ غيرُ مدير — لا يرى العمودَ الخاصَّ أصلاً

type Shape = {
  lists: { id: number; privateToAssignee?: boolean }[];
  cards: { listId: number; technicianId: number | null }[];
};

/**
 * يُطبّق قاعدتَي العمود الخاصّ: **مَن يرى ماذا**، ثمّ **إخفاؤه إذا خلا**.
 * دالّةٌ خالصةٌ (بلا قاعدةِ بيانات) كي تُختبَر سلوكيّاً لا بمطابقةِ نصّ.
 */
export function applyPrivateLists<T extends Shape>(data: T, viewer: BoardViewer): T {
  const privateIds = new Set(
    data.lists.filter((l) => l.privateToAssignee === true).map((l) => l.id),
  );
  if (privateIds.size === 0) return data;

  // ١) حجبُ البطاقات: المديرُ يرى الكلَّ · الفنيُّ بطاقاتَه · مستخدمُ المكتب لا شيء
  const cards = data.cards.filter((c) => {
    if (!privateIds.has(c.listId)) return true;
    if (viewer.kind === "manager") return true;
    if (viewer.kind === "technician") return c.technicianId === viewer.technicianId;
    return false;
  });

  // ٢) والعمودُ الخاصُّ يظهر **فقط إذا فيه بطاقاتٌ يراها هذا الناظر**
  const nonEmpty = new Set(cards.map((c) => c.listId));
  const lists = data.lists.filter((l) => !privateIds.has(l.id) || nonEmpty.has(l.id));

  return { ...data, lists, cards };
}
