import { redirect } from "next/navigation";

// وصولات فواتير المبيع صارت حصرياً في صفحة فاتورة المبيع (زر «سجل وصولات المبيع»)
// بطلب صريح: لا تظهر في أي مكان آخر — هذه الصفحة تحوّل إليها.
export default function InvoicesReportRedirect() {
  redirect("/invoices");
}
