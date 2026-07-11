import ModuleTile from "@/components/ModuleTile";
import { formatDate } from "@/lib/format";
import { getSession } from "@/lib/auth";
import { computeDailyReport } from "@/lib/dailyReport";

// إعادة الحساب في كل زيارة (لا تخزين مؤقت) — حتى تتصفّر أرقام اليوم فوراً بعد منتصف الليل
export const dynamic = "force-dynamic";

// نفس أزرار الشاشة الرئيسية في البرنامج الأصلي تماماً (9 أزرار)
const TILES = [
  { label: "المشتركين", icon: "👤", color: "#e11d48", href: "/subscribers", enabled: true },
  { label: "تقرير الفواتير", icon: "📋", color: "#0891b2", href: "/reports/invoices", enabled: true },
  { label: "ارسال رسالة للكل", icon: "💬", color: "#22c55e", href: "/messages/compose", enabled: true },
  { label: "ديون المشتركين", icon: "📑", color: "#f59e0b", href: "/debts", enabled: true },
  { label: "فاتورة مبيع", icon: "🛒", color: "#ef4444", href: "/invoices", enabled: true },
  { label: "حسابات المدير", icon: "🧾", color: "#3b82f6", href: "/manager-accounts", enabled: true },
  { label: "تقرير تفصيلي", icon: "🧾", color: "#8b5cf6", href: "/reports/detailed", enabled: true },
  { label: "التقرير الاجمالي", icon: "📊", color: "#10b981", href: "/reports/overall", enabled: true },
  { label: "الصندوق", icon: "🧮", color: "#0ea5e9", href: "/cashbox", enabled: true },
];

const fmt = (n: number | null | undefined) =>
  n == null ? "0" : Number(n).toLocaleString("en-US");

export default async function DashboardPage() {
  // التقرير اليومي مُقيَّد بمكتب المستخدم (الأدمن يرى كل المكاتب)
  const session = await getSession();
  const towerId = session && !session.isAdmin ? session.towerId : null;
  const r = await computeDailyReport(towerId);
  const dailyTotal = r.total;

  const reportRows = [
    { cat: "تفعيل اشتراكات", count: r.activationCount, total: "", wasel: fmt(r.activationIn) },
    { cat: "فاتورة المبيع", count: r.invoiceCount, total: "", wasel: fmt(r.invoiceIn) },
    { cat: "المقبوضات (اليوم)", count: "", total: "", wasel: fmt(r.otherIn) },
    { cat: "المصروفات (اليوم)", count: "", total: "", wasel: fmt(r.expenses) },
  ];

  return (
    <div className="mynet-canvas min-h-[calc(100vh-140px)] p-5">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* لوحة التقرير اليومي (يسار) */}
        <aside className="rounded-xl bg-white shadow-xl">
          <div className="flex items-center justify-between rounded-t-xl bg-slate-100 px-4 py-3">
            <span className="text-xs text-slate-400">
              {formatDate(new Date())}
            </span>
            <h2 className="text-lg font-bold text-slate-800">التقرير اليومي</h2>
          </div>
          <div className="overflow-hidden p-3">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200 text-slate-500">
                  <th className="p-2 font-semibold">الفئة</th>
                  <th className="p-2 font-semibold">العدد</th>
                  <th className="p-2 font-semibold">المجموع</th>
                  <th className="p-2 font-semibold">الواصل</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((r) => (
                  <tr key={r.cat} className="border-b border-slate-100">
                    <td className="p-2 font-medium text-slate-700">{r.cat}</td>
                    <td className="p-2 text-slate-500">{r.count}</td>
                    <td className="p-2 text-slate-500">{r.total}</td>
                    <td className="p-2 font-semibold text-emerald-600">
                      {r.wasel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 rounded-lg bg-emerald-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-extrabold text-emerald-600">
                  {fmt(dailyTotal)} د.ع
                </span>
                <span className="text-sm font-semibold text-slate-600">
                  المجموع
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* شبكة الوحدات (يمين) */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {TILES.map((t) => (
            <ModuleTile
              key={t.label}
              label={t.label}
              icon={t.icon}
              color={t.color}
              href={t.href}
              enabled={t.enabled ?? false}
            />
          ))}
        </section>
      </div>
    </div>
  );
}
