// هندسة ورق الوصل — وحدة نقيّة (بلا prisma) يشاركها الخادم (توليد PDF/HTML) والواجهة
// (مدخلات الأبعاد + المعاينة). كلّ مكتب/وكيل يكتب أبعاد ورق طابعته يدويّاً، ويختار أيّ
// معلومةٍ تظهر في الوصل — فيُطبع بعرض تلك الورقة والمحتوى **موسَّطاً** فيها.

// أبعاد الورقة بالمليمتر (مصدرها الوحيد resolveDims):
//   paperW  = عرض الورقة (عرض صفحة الـPDF/‏@page)
//   paperH  = طول الورقة الثابت (ورق مقصوص). 0 ⇒ لفّة حراريّة: الطول = طول المحتوى.
//   contentW= عرض صندوق الكتابة، موسَّطٌ ⇒ هامشا بياضٍ متساويان = (paperW-contentW)/2
//   padX    = حشو أفقيّ داخل صندوق الكتابة (ثابت صغير كي لا يلامس النصّ الحدّ)
export type PaperDims = { paperW: number; paperH: number; contentW: number; padX: number };

export const PAPER_LIMITS = { minW: 30, maxW: 400, minH: 40, maxH: 600, minC: 20 };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// ترحيل القوالب القديمة: كانت تخزّن نوعاً مُعدّاً (paper) بدل أبعادٍ رقميّة.
const LEGACY: Record<string, { paperW: number; paperH: number; contentW: number }> = {
  thermal58: { paperW: 58, paperH: 0, contentW: 46 },
  thermal76: { paperW: 76, paperH: 0, contentW: 64 },
  thermal80: { paperW: 80, paperH: 0, contentW: 68 },
  a4: { paperW: 210, paperH: 297, contentW: 78 },
  letter: { paperW: 216, paperH: 279, contentW: 78 },
};

// الأبعاد الفعّالة من القالب: أرقامٌ صريحة إن وُجدت، وإلا اشتقاقٌ من النوع القديم، وإلا
// الافتراضيّ (٨٠مم لفّة). يُقصُّ كلٌّ ضمن حدوده، وعرض الكتابة ≤ عرض الورقة.
export function resolveDims(t: {
  paperW?: number | null; paperH?: number | null; contentW?: number | null; paper?: string | null;
}): PaperDims {
  let pw = Number(t.paperW) || 0;
  let ph = Number(t.paperH) || 0;
  let cw = Number(t.contentW) || 0;
  if (!pw && t.paper && LEGACY[t.paper]) { const L = LEGACY[t.paper]; pw = L.paperW; ph = L.paperH; cw = L.contentW; }
  pw = clamp(pw || 80, PAPER_LIMITS.minW, PAPER_LIMITS.maxW);
  ph = ph > 0 ? clamp(ph, PAPER_LIMITS.minH, PAPER_LIMITS.maxH) : 0;
  cw = clamp(cw || Math.max(pw - 12, PAPER_LIMITS.minC), PAPER_LIMITS.minC, pw);
  return { paperW: pw, paperH: ph, contentW: cw, padX: 3 };
}

// ===== حقول الوصل: إظهار/إخفاء + إعادة ترتيب (وصل الاشتراك) =====
// مشتركة بين الخادم (البناء) والواجهة. الافتراضيّ: الكلّ ظاهر بالترتيب أدناه.
//   • RECEIPT_FIELDS: صفوف الجسم — قابلة للإظهار/الإخفاء **وإعادة الترتيب بالسحب**.
//   • RECEIPT_TOGGLES: مفاتيح ثابتة الموضع (سطر العنوان الفرعيّ/التذييل) — إظهار فقط.
export const RECEIPT_FIELDS = [
  { key: "receiptNo", label: "رقم الوصل" },
  { key: "date", label: "التاريخ" },
  { key: "subscriber", label: "اسم المشترك" },
  { key: "phone", label: "رقم الهاتف" },
  { key: "package", label: "الباقة" },
  { key: "months", label: "عدد الأشهر" },
  { key: "dateFrom", label: "من تاريخ" },
  { key: "dateTo", label: "إلى تاريخ" },
  { key: "price", label: "قيمة الاشتراك" },
  { key: "moneyIn", label: "المبلغ الواصل" },
  { key: "moneyCarry", label: "الدين المتبقّي" },
  { key: "notes", label: "الملاحظات" },
  // «ادرس 1» من الساس (طلب محمد 2026-08-09) — **مُطفأ افتراضيّاً**: لا يظهر إلا إن شغّله المدير
  { key: "address", label: "العنوان (ادرس 1 من الساس)" },
] as const;

// حقولٌ لا تظهر إلا بتشغيل المدير صراحةً (افتراضها مُطفأ، بخلاف بقيّة الحقول الظاهرة افتراضاً)
const OFF_BY_DEFAULT = new Set<string>(["address", "officeInFooter"]);

export const RECEIPT_TOGGLES = [
  { key: "subtitle", label: "سطر «وصل تفعيل / تجديد»" },
  { key: "footer", label: "سطر التذييل" },
  // اسم المكتب أسفل الوصل — **مُطفأٌ افتراضيّاً** (طلب محمد 2026-08-09): يبقى بالترويسة أعلى
  // الوصل، ومن أراد إظهاره في التذييل أيضاً يشغّله من هنا.
  { key: "officeInFooter", label: "اسم المكتب في التذييل" },
] as const;

export type ReceiptBodyKey = (typeof RECEIPT_FIELDS)[number]["key"];
export type ReceiptFieldKey = ReceiptBodyKey | (typeof RECEIPT_TOGGLES)[number]["key"];
export type ReceiptFields = Record<ReceiptFieldKey, boolean>;

const ALL_FIELDS = [...RECEIPT_FIELDS, ...RECEIPT_TOGGLES];
export const DEFAULT_FIELDS: ReceiptFields = Object.fromEntries(
  ALL_FIELDS.map((f) => [f.key, !OFF_BY_DEFAULT.has(f.key)]),
) as ReceiptFields;

export const DEFAULT_ORDER: ReceiptBodyKey[] = RECEIPT_FIELDS.map((f) => f.key);

// دمج حقول القالب مع الافتراضيّ: أيّ مفتاحٍ غائب (قالب قديم) ⇒ ظاهر.
export function resolveFields(f: Partial<Record<string, boolean>> | null | undefined): ReceiptFields {
  return { ...DEFAULT_FIELDS, ...(f ?? {}) } as ReceiptFields;
}

// ترتيبٌ صالح لصفوف الجسم: يحترم ترتيب القالب، يُسقط المجهول والمكرَّر، ويُلحق أيّ حقلٍ
// ناقص (قالب قديم أو حقل مُستحدَث) بترتيبه الافتراضيّ — فلا يختفي حقلٌ أبداً بسبب الترتيب.
export function resolveOrder(order: string[] | null | undefined): ReceiptBodyKey[] {
  const valid = new Set<string>(DEFAULT_ORDER);
  const seen = new Set<string>();
  const out: ReceiptBodyKey[] = [];
  for (const k of order ?? []) {
    if (valid.has(k) && !seen.has(k)) { out.push(k as ReceiptBodyKey); seen.add(k); }
  }
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) out.push(k);
  return out;
}

// ===== قالب «وصل المشترك» (وصلٌ لكلّ مشترك من صفحة كلّ المشتركين — طلب محمد 2026-08-09) =====
// قالبٌ خاصٌّ مستقلٌّ عن وصل الاشتراك: كلّ حقولِه اختياريّة (منها العنوان/ادرس 1).
export const NOTICE_FIELDS = [
  { key: "date", label: "تاريخ الطبع" },
  { key: "subscriber", label: "اسم المشترك" },
  { key: "netUser", label: "اسم المستخدم (اليوزر)" },
  { key: "phone", label: "رقم الهاتف" },
  { key: "address", label: "العنوان (ادرس 1 من الساس)" },
  { key: "package", label: "الباقة" },
  { key: "price", label: "قيمة الاشتراك" },
  { key: "dateTo", label: "تاريخ الانتهاء" },
  { key: "carry", label: "الدين المتبقّي" },
  { key: "office", label: "المكتب" },
] as const;

export type NoticeBodyKey = (typeof NOTICE_FIELDS)[number]["key"];
export const NOTICE_DEFAULT_ORDER: NoticeBodyKey[] = NOTICE_FIELDS.map((f) => f.key);
// كلّ حقول وصل المشترك ظاهرةٌ افتراضاً (العنوان منها — هو سببُ إنشائه) + مفاتيح الترويسة/التذييل
// كلّ حقول وصل المشترك ظاهرةٌ افتراضاً — **بما فيها العنوان** (هو سببُ إنشاء هذا القالب)،
// ويُستثنى «اسم المكتب في التذييل» وحده فيبقى مُطفأً كما في وصل الاشتراك.
export const NOTICE_DEFAULT_FIELDS = Object.fromEntries(
  [...NOTICE_FIELDS, ...RECEIPT_TOGGLES].map((f) => [f.key, f.key !== "officeInFooter"]),
) as Record<string, boolean>;

export function resolveNoticeFields(f: Partial<Record<string, boolean>> | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = { ...NOTICE_DEFAULT_FIELDS };
  for (const [k, v] of Object.entries(f ?? {})) if (typeof v === "boolean") out[k] = v;
  return out;
}
export function resolveNoticeOrder(order: string[] | null | undefined): NoticeBodyKey[] {
  const valid = new Set<string>(NOTICE_DEFAULT_ORDER);
  const seen = new Set<string>();
  const out: NoticeBodyKey[] = [];
  for (const k of order ?? []) if (valid.has(k) && !seen.has(k)) { out.push(k as NoticeBodyKey); seen.add(k); }
  for (const k of NOTICE_DEFAULT_ORDER) if (!seen.has(k)) out.push(k);
  return out;
}
