import DailyReportCard from "@/components/DailyReportCard";
import StatCards from "@/components/StatCards";
import SubscribersBoard from "@/components/SubscribersBoard";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { computeDailyReport } from "@/lib/dailyReport";
import { prisma } from "@/lib/prisma";

// الشاشة الرئيسية بالطراز الجديد (ب2): بطاقات الإحصاء الأربع + جدول المشتركين
// (يحلّ محلّ صفحة /subscribers) + التقرير اليومي + شريط تحصيل الفنيين.
// إعادة الحساب في كل زيارة (لا تخزين مؤقت) — حتى تتصفّر أرقام اليوم فوراً بعد منتصف الليل
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  const isAdmin = !!session?.isAdmin;
  // عزل المستأجر: المدير يرى إجمالي مكاتب وكيله فقط؛ مستخدم المكتب يرى مكتبه
  const agentTowers = await agentTowerIds(session ?? null);
  const scope: number | number[] | null = isAdmin ? agentTowers : session?.towerId ?? null;
  const [initialReport, towers] = await Promise.all([
    computeDailyReport(scope),
    isAdmin
      ? prisma.tower.findMany({ where: { isDeleted: false, id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true }, orderBy: { id: "asc" } })
      : Promise.resolve([] as { id: number; name: string | null }[]),
  ]);
  const counterTowers = isAdmin ? agentTowers : session?.towerId ? [session.towerId] : [];

  return (
    // .nst: نطاق CSS النموذج المعتمد (الصفحة التجريبية) — بنيته حرفياً:
    // بطاقات الإحصاء ثم row2: [المشتركين + تحصيل الفنيين | التقرير اليومي]
    <div className="nst nst-fill min-h-screen bg-ground p-4 min-[1051px]:p-[20px_22px_16px]" style={{ display: "grid", gap: 17, alignContent: "start" }}>
      <StatCards initialReport={initialReport} towerIds={counterTowers} />
      {/* نقطة الكسر 1051px نفسها المستعملة في طبقة التكيّف مع الارتفاع */}
      <div className="row2 max-[1050px]:!grid-cols-1">
        <SubscribersBoard />
        <DailyReportCard isAdmin={isAdmin} towers={towers} initial={initialReport} />
      </div>
    </div>
  );
}
