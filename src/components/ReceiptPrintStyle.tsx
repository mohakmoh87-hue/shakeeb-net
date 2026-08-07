// نمط طباعة الوصل من المتصفّح (Ctrl+P) — يتبع أبعاد ورق الطابعة اليدويّة للمكتب/الوكيل.
// مقتصر على صفحات الوصل (‎.receipt-page‎) فلا يؤثّر على التقارير (تبقى A4).
// عرض الورقة يدويّ، بلا هوامش، أبيض/أسود، وصندوق الكتابة موسَّطٌ (margin:auto) ⇒ يُطبع
// وسط الورقة أيّاً كان عرضها.
import { resolveDims } from "@/lib/receiptPaper";

export default function ReceiptPrintStyle({ paperW, paperH, contentW }: { paperW?: number; paperH?: number; contentW?: number }) {
  const g = resolveDims({ paperW, paperH, contentW });
  const sheet = g.paperH > 0; // ورق مقصوص (طول ثابت) مقابل لفّة حراريّة
  const pageSize = sheet ? `${g.paperW}mm ${g.paperH}mm` : `${g.paperW}mm auto`;
  const css = `
@media print {
  /* حجم الورقة يتبع أبعاد المكتب: لفّة حراريّة (طول تلقائيّ يُقصّ بنهاية الكتابة)
     أو ورق مقصوص (صفحة كاملة والمحتوى أعلى-وسط) */
  @page { size: ${pageSize}; margin: 0; }
  html, body {
    width: ${g.paperW}mm !important;
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
    width: ${g.paperW}mm !important;
    max-width: ${g.paperW}mm !important;
    margin: 0 !important;
  }
  /* صندوق الكتابة موسَّطٌ على الورقة ⇒ هامشا بياضٍ متساويان (لا يُطبَعان فلا تقصّهما
     الطابعة) + حشو داخليّ ⇒ يبدأ النص بعيداً عن حافة الورق. الكتابة + الهامشان = عرض الورقة. */
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
