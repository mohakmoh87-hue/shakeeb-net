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

// وإشاراتُ حساب الماستر — مشتقّةٌ من معادلته في `api/manager-accounts/route.ts`:
//   الماستر = (Σ moneyIn − Σ moneyOut بوسم الماستر) + master-receipt − master-expense
export const MASTER_SIGN: Record<string, 1 | -1> = {
  "master-receipt": 1,
  "master-expense": -1,
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

export type TotalLogRow = TotalLogEntry & { balanceAfter: number };

// 💰 الرصيدُ بعد كلّ حركة («كم أصبح المبلغ» — طلبُ محمد 2026-10-24): يُحسَب من الأقدم
// صعوداً فيتراكم كدفترٍ حقيقيّ، والقائمةُ تبقى معروضةً من الأحدث. فرصيدُ أوّلِ سطرٍ
// معروضٍ = المبلغُ الكلّيُّ الموجود، ورصيدُ آخرِ سطرٍ = أثرُ أوّلِ عمليّةٍ وحدَها.
export function withRunningBalance(newestFirst: TotalLogEntry[]): TotalLogRow[] {
  let balance = 0;
  const ascending = [...newestFirst].reverse().map((e) => {
    balance += entrySigned(e);
    return { ...e, balanceAfter: balance };
  });
  return ascending.reverse();
}
