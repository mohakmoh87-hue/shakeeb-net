import ModuleTile from "@/components/ModuleTile";
import DailyReportCard from "@/components/DailyReportCard";
import { getSession } from "@/lib/auth";
import { computeDailyReport } from "@/lib/dailyReport";
import { prisma } from "@/lib/prisma";

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

export default async function DashboardPage() {
  // التقرير اليومي: مستخدم المكتب يرى مكتبه؛ المدير يرى الإجمالي مبدئياً ويختار مكتباً عبر التبويبات
  const session = await getSession();
  const isAdmin = !!session?.isAdmin;
  const towerId = isAdmin ? null : session?.towerId ?? null;
  const initialReport = await computeDailyReport(towerId);
  const towers = isAdmin
    ? await prisma.tower.findMany({ where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" } })
    : [];

  return (
    <div className="mynet-canvas min-h-[calc(100vh-140px)] p-5">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* لوحة التقرير اليومي (يسار) — تبويبات للمدير: الإجمالي + كل مكتب */}
        <DailyReportCard isAdmin={isAdmin} towers={towers} initial={initialReport} />

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
