// نمط طباعة مخصّص لطابعة POS الحرارية بعرض 80 ملم.
// مقتصر على صفحات الوصل (‎.receipt-page‎) فلا يؤثّر على التقارير (تبقى A4).
// يُجبر العرض على 80 ملم، بلا هوامش، أبيض/أسود لتوافق الطابعة الحرارية.
export default function ReceiptPrintStyle() {
  const css = `
@media print {
  @page { size: 80mm 120mm; margin: 0; }
  html, body {
    width: 80mm !important;
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
    width: 80mm !important;
    max-width: 80mm !important;
    margin: 0 !important;
  }
  /* عرض الورقة 80مم. صندوق الكتابة 68مم موسَّط ⇒ فراغ أبيض حقيقي ~6مم بكل جانب
     (لا يُطبَع فلا تقصّه الطابعة) + حشو داخلي 4مم ⇒ يبدأ النص على بُعد ~10مم من حافة الورق،
     وهو أكبر من الهامش غير القابل للطباعة في أي طابعة حرارية/عادية. الكتابة + الهامشان = 80مم. */
  .print-area {
    width: 68mm !important;
    max-width: 68mm !important;
    box-sizing: border-box !important;
    padding: 3mm 4mm !important;
    margin: 0 auto !important;   /* توسيط الكتابة على الورقة ⇒ هامشان متساويان */
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
