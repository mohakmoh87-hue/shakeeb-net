// قناة «تغيّر مال»: تُطلقها كل عملية مالية (تفعيل/تسديد دين/تحصيل فني/حذف عكسي…)
// وتلتقطها بطاقات الشاشة الرئيسية (التقرير اليومي/المصروفات والمقبوضات/فاتورة المبيع)
// فتتحدّث فوراً، وتتحدّث كذلك عند العودة للصفحة — بلا أي مؤقّت دوري (قرار محمد
// 2026-07-29 بعد حادثة «فرق الـ35 ألفاً»: بطاقة تقرير لا تتحدّث بعد عمليات صاحبها).
export const MONEY_CHANGED_EVENT = "shk:money-changed";

export function announceMoneyChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MONEY_CHANGED_EVENT));
}

// اشتراك بطاقة بالتحديث: فوري عند الإشعار المالي، وعند العودة للنافذة/التبويب
// (بكابح 8 ثوانٍ للعودة فقط كي لا يتكرّر الجلب المتقارب). يُرجع دالة التنظيف.
export function onMoneyRefresh(cb: () => void): () => void {
  let last = 0;
  const immediate = () => { last = Date.now(); cb(); };
  const throttled = () => { if (Date.now() - last < 8000) return; last = Date.now(); cb(); };
  const onVis = () => { if (document.visibilityState === "visible") throttled(); };
  window.addEventListener(MONEY_CHANGED_EVENT, immediate);
  window.addEventListener("focus", throttled);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.removeEventListener(MONEY_CHANGED_EVENT, immediate);
    window.removeEventListener("focus", throttled);
    document.removeEventListener("visibilitychange", onVis);
  };
}
