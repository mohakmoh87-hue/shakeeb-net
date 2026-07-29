import Link from "next/link";
import DailyReportCard from "@/components/DailyReportCard";
import FieldSettlementCard from "@/components/FieldSettlementCard";
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
    <div className="flex min-h-screen flex-col gap-3 bg-ground p-3 xl:h-screen xl:min-h-0 xl:overflow-hidden">
      {/* بطاقات الإحصاء الأربع */}
      <StatCards initialReport={initialReport} towerIds={counterTowers} />

      {/* الجسم: جدول المشتركين (+ تحصيل الفنيين أسفله) | التقرير اليومي */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-[420px] flex-1 xl:min-h-0">
            <SubscribersBoard />
          </div>
          {/* تحصيل الفنيين — شريط أفقي أسفل الجدول */}
          <FieldSettlementCard />
        </div>

        <div className="flex min-h-0 flex-col gap-2 xl:overflow-y-auto">
          {/* زرّ سجل الوصولات البرتقالي أعلى بطاقة التقرير */}
          <Link href="/subscriptions"
            className="block rounded-xl py-2.5 text-center text-sm font-extrabold text-white shadow-sm transition hover:brightness-105"
            style={{ background: "linear-gradient(160deg, var(--orange) 0%, var(--orange-d) 100%)" }}>
            🧾 سجل الوصولات
          </Link>
          <DailyReportCard isAdmin={isAdmin} towers={towers} initial={initialReport} />
        </div>
      </div>
    </div>
  );
}
