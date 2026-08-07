// نمط طباعة الوصل من المتصفّح (Ctrl+P) — يتبع حجم ورق الطابعة المختار للمكتب/الوكيل.
// مقتصر على صفحات الوصل (‎.receipt-page‎) فلا يؤثّر على التقارير (تبقى A4).
// يُجبر العرض على عرض الورقة، بلا هوامش، أبيض/أسود لتوافق الطابعة الحرارية،
// وصندوق الكتابة موسَّطٌ (margin:auto) ⇒ يُطبع وسط الورقة أيّاً كان عرضها.
import { paperGeometry, DEFAULT_PAPER, type PaperKind } from "@/lib/receiptPaper";

export default function ReceiptPrintStyle({ paper = DEFAULT_PAPER }: { paper?: PaperKind }) {
  const g = paperGeometry(paper);
  const sheet = g.pageH > 0; // ورق مقصوص (A4/Letter) بطولٍ ثابت مقابل لفّة حراريّة
  const pageSize = sheet ? `${g.pageW}mm ${g.pageH}mm` : `${g.pageW}mm auto`;
  const css = `
@media print {
  /* حجم الورقة يتبع اختيار المكتب: لفّة حراريّة (طول تلقائيّ يُقصّ بنهاية الكتابة)
     أو ورق مقصوص A4/Letter (صفحة كاملة والمحتوى أعلى-وسط) */
  @page { size: ${pageSize}; margin: 0; }
  html, body {
    width: ${g.pageW}mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  .receipt-page {
    display: block !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    background: #fff !important;
  }
  .receipt-page > * {
    width: ${g.pageW}mm !important;
    max-width: ${g.pageW}mm !important;
    margin: 0 !important;
  }
  /* صندوق الكتابة موسَّطٌ على الورقة ⇒ هامشا بياضٍ متساويان (لا يُطبَعان فلا تقصّهما
     الطابعة) + حشو داخليّ ⇒ يبدأ النص بعيداً عن حافة الورق، أبعد من الهامش غير القابل
     للطباعة في أيّ طابعة. الكتابة + الهامشان = عرض الورقة. */
  .print-area {
    width: ${g.contentW}mm !important;
    max-width: ${g.contentW}mm !important;
    box-sizing: border-box !important;
    padding: 3mm ${g.padX}mm !important;
    margin: 0 auto !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    background: #fff !important;
    color: #000 !important;
  }
  /* الطابعة الحرارية أحادية اللون: كل النص أسود خالص وعريض (بولد) لوضوح الطباعة،
     بلا خلفيات ملوّنة، وكسر الكلمات الطويلة */
  .print-area *:not(img) {
    color: #000 !important;
    border-color: #000 !important;
    background: transparent !important;
    font-weight: 700 !important;
    opacity: 1 !important;
    max-width: 100% !important;
    overflow-wrap: break-word !important;
    word-break: break-word !important;
  }
}
`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
