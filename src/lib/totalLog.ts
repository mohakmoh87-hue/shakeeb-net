// ═════ إشاراتُ حركات «المبلغ الكلّي الموجود» ومجموعُها ═════
// مشتقّةٌ حرفيّاً من معادلة `managerBalances`:
//   الكلّي = صافي التقارير اليوميّة − card-payment − expense − salary + receipt
// فأيُّ نوعٍ يُضاف للمعادلة لاحقاً يجب أن يُضاف هنا، وحارسُ الاختبار يسقط إن اختلفا.
export const TOTAL_SIGN: Record<string, 1 | -1> = {
  receipt: 1,
  expense: -1,
  "card-payment": -1,
  salary: -1,
};

export type TotalLogEntry = {
  kind: "daily" | "manager";
  key: string;
  at: string;
  day: string | null;
  label: string;
  type?: string;
  amount: number;
  sign: 1 | -1;
  moneyIn?: number;
  moneyOut?: number;
  count?: number;
  notes: string | null;
  byName: string | null;
  forManager?: boolean;
};

// سطرُ «تقرير يوميّ» مبلغُه صافٍ موقَّعٌ سلفاً (قد يكون سالباً)، فيُجمَع كما هو؛
// وحركةُ المدير مبلغُها مطلقٌ وإشارتُها من النوع.
export function entrySigned(e: TotalLogEntry): number {
  return e.kind === "daily" ? e.amount : e.sign * e.amount;
}

export function totalLogTotal(entries: TotalLogEntry[]): number {
  return entries.reduce((s, e) => s + entrySigned(e), 0);
}
