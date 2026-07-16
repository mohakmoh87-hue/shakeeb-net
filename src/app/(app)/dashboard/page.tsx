import ModuleTile from "@/components/ModuleTile";
import DailyReportCard from "@/components/DailyReportCard";
import FieldSettlementCard from "@/components/FieldSettlementCard";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
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
  { label: "إدارة الفنيين", icon: "🛠️", color: "#0ea5e9", href: "/field-management", enabled: true },
];

export default async function DashboardPage() {
  // التقرير اليومي: مستخدم المكتب يرى مكتبه؛ المدير يرى الإجمالي مبدئياً ويختار مكتباً عبر التبويبات
  const session = await getSession();
  const isAdmin = !!session?.isAdmin;
  // عزل المستأجر: المدير يرى إجمالي مكاتب وكيله فقط؛ مستخدم المكتب يرى مكتبه
  const agentTowers = await agentTowerIds(session ?? null);
  const scope: number | number[] | null = isAdmin ? agentTowers : session?.towerId ?? null;
  // جلب متوازٍ لتقليل ذهاب/إياب الشبكة (أسرع فتحاً)
  const [initialReport, towers] = await Promise.all([
    computeDailyReport(scope),
    isAdmin
      ? prisma.tower.findMany({ where: { isDeleted: false, id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true }, orderBy: { id: "asc" } })
      : Promise.resolve([] as { id: number; name: string | null }[]),
  ]);

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

      {/* تحصيل الفنيين — اسم كل فني ومجموع تكتاته المنجزة وزر اكمال (لكل مكتب) */}
      <FieldSettlementCard />
    </div>
  );
}
