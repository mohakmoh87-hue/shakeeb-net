// منطق حساب الاشتراك (التفعيل/التجديد)

// إضافة عدد أشهر إلى تاريخ
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // معالجة نهاية الشهر (مثلاً 31 → شهر بلا 31)
  if (d.getDate() < day) d.setDate(0);
  return d;
}

// إضافة عدد أيام إلى تاريخ
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// حساب تاريخ الانتهاء حسب نظام تفعيل المكتب
// mode = "days30" → 30 يوماً لكل شهر، غير ذلك → نفس تاريخ اليوم بالشهر التالي
export function computeDateTo(start: Date, months: number, mode: string | null | undefined): Date {
  return mode === "days30" ? addDays(start, 30 * months) : addMonths(start, months);
}

// حساب تفاصيل التفعيل
export function computeActivation(opts: {
  packagePrice: number; // سعر الباقة (للشهر الواحد)
  months: number; // عدد الأشهر
  previousCarry: number; // الدين السابق
  paid: number; // المبلغ المدفوع (الواصل)
  currentDateTo: Date | null; // تاريخ انتهاء الاشتراك الحالي
  activationDate: Date; // تاريخ العملية
}) {
  const total = opts.packagePrice * opts.months; // قيمة الاشتراك
  const totalDue = total + opts.previousCarry; // المطلوب الكلي
  const newCarry = totalDue - opts.paid; // الدين الجديد بعد الدفع

  // يبدأ الاشتراك الجديد من نهاية الحالي إن كان مستقبلياً، وإلا من تاريخ العملية
  const start =
    opts.currentDateTo && opts.currentDateTo > opts.activationDate
      ? opts.currentDateTo
      : opts.activationDate;
  const dateTo = addMonths(start, opts.months);

  return { total, totalDue, newCarry, dateFrom: start, dateTo };
}
