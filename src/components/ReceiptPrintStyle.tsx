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
  .print-area {
    width: 80mm !important;
    max-width: 80mm !important;
    box-sizing: border-box !important;
    padding: 3mm 4mm !important;
    margin: 0 !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    background: #fff !important;
    color: #000 !important;
  }
  /* الطابعة الحرارية أحادية اللون: أسود على أبيض، بلا خلفيات ملوّنة */
  .print-area *:not(img) {
    color: #000 !important;
    border-color: #000 !important;
    background: transparent !important;
  }
}
`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
