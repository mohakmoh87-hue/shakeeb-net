// هندسة ورق الوصل — وحدة نقيّة (بلا prisma) يشاركها الخادم (توليد PDF/HTML) والواجهة
// (مُبدِّل حجم الورقة + المعاينة). كلّ مكتب/وكيل يختار حجم ورقة طابعته، فيُطبع الوصل
// بعرض تلك الورقة والمحتوى **موسَّطاً** فيها — يعالج انزياح الوصل الضيّق لجانب الورقة.

export type PaperKind = "thermal58" | "thermal76" | "thermal80" | "a4" | "letter";

export const DEFAULT_PAPER: PaperKind = "thermal80";

// هندسة الورقة بالمليمتر:
//   pageW   = عرض الورقة (عرض صفحة الـPDF/‏@page)
//   pageH   = طول الورقة الثابت (ورق مقصوص A4/Letter). 0 ⇒ لفّة حراريّة: الطول = طول
//             المحتوى (يُقاس وقت التوليد) فتُقصّ بنهاية الكتابة — ورقة واحدة دائماً.
//   contentW= عرض صندوق الكتابة، موسَّطٌ بـ margin:auto ⇒ هامشا بياضٍ متساويان
//   padX    = حشو أفقيّ داخل صندوق الكتابة
export type PaperGeometry = { pageW: number; pageH: number; contentW: number; padX: number };

export function paperGeometry(kind: PaperKind | null | undefined): PaperGeometry {
  switch (kind) {
    case "thermal58": return { pageW: 58, pageH: 0, contentW: 46, padX: 3 };
    case "thermal76": return { pageW: 76, pageH: 0, contentW: 64, padX: 4 };
    case "a4":        return { pageW: 210, pageH: 297, contentW: 78, padX: 5 };
    case "letter":    return { pageW: 216, pageH: 279, contentW: 78, padX: 5 };
    case "thermal80":
    default:          return { pageW: 80, pageH: 0, contentW: 68, padX: 4 };
  }
}

export const PAPER_OPTIONS: { value: PaperKind; label: string; hint: string }[] = [
  { value: "thermal80", label: "حراريّة ٨٠مم", hint: "الأكثر شيوعاً لطابعات الوصولات (POS)" },
  { value: "thermal76", label: "حراريّة ٧٦مم", hint: "طابعات الوصولات الأقدم/الإبريّة" },
  { value: "thermal58", label: "حراريّة ٥٨مم", hint: "طابعات الوصولات الصغيرة" },
  { value: "a4",        label: "A4 عاديّة",    hint: "طابعة حبر/ليزر — الوصل عمودٌ موسَّط في الصفحة" },
  { value: "letter",    label: "Letter عاديّة", hint: "طابعة حبر/ليزر بمقاس Letter" },
];

export function paperLabel(kind: PaperKind | null | undefined): string {
  return PAPER_OPTIONS.find((o) => o.value === kind)?.label ?? "حراريّة ٨٠مم";
}
