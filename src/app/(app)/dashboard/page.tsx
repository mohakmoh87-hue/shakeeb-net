import DailyReportCard from "@/components/DailyReportCard";
import StatCards from "@/components/StatCards";
import SubscribersBoard from "@/components/SubscribersBoard";
import TrialFmCard from "@/components/TrialFmCard";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { computeDailyReport, reportUserScope } from "@/lib/dailyReport";
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
  // مكتبٌ فيه مستخدمان+ ⇒ التقرير الأوّلي لمستخدم المكتب = تقريره هو وحده (طلب محمد 2026-08-08)
  const forcedUser = !isAdmin && session ? await reportUserScope(session) : undefined;
  const [initialReport, towers, towerUsers] = await Promise.all([
    computeDailyReport(scope, undefined, forcedUser),
    isAdmin
      ? prisma.tower.findMany({ where: { isDeleted: false, id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true }, orderBy: { id: "asc" } })
      : Promise.resolve([] as { id: number; name: string | null }[]),
    // مستخدمو مكاتب الوكيل (للمدير): تبويب اختيار المستخدم لمكتبٍ فيه مستخدمان+
    // ═════ 🔒 «الحساب المنفصل» شرطُ الظهور — حكماً على **المكتب** (بلاغا محمد 2026-08-26) ═════
    // مكتبٌ فيه مستخدمان+ وأيٌّ منهم مفصول ⇒ تظهر تبويباتُ **كلِّ** مستخدميه (حالةُ
    // كاسبر: كان أبو فهد غيرَ مؤشَّرٍ فيغيب عن التبويبات ويرى مالَ زملائه معاً).
    // ومكتبٌ بلا مؤشَّرٍ واحدٍ أو بمستخدمٍ واحد ⇒ «المكتبُ فقط» بلا أيّ تغيير (قاعدة د).
    isAdmin
      ? prisma.user.findMany({
          where: { agentId: session?.agentId ?? -1, isDeleted: false, isActive: true, isOwner: false, towerId: { not: null } },
          select: { id: true, fullName: true, username: true, towerId: true, separateAccount: true }, orderBy: { id: "asc" },
        }).then((us) => {
          const sepTowers = new Set(us.filter((u) => u.separateAccount).map((u) => u.towerId));
          const perTower = new Map<number, number>();
          for (const u of us) perTower.set(u.towerId as number, (perTower.get(u.towerId as number) ?? 0) + 1);
          return us
            .filter((u) => sepTowers.has(u.towerId) && (perTower.get(u.towerId as number) ?? 0) >= 2)
            .map((u) => ({ id: u.id, name: u.fullName || u.username, towerId: u.towerId as number }));
        })
      : Promise.resolve([] as { id: number; name: string; towerId: number }[]),
  ]);
  const counterTowers = isAdmin ? agentTowers : session?.towerId ? [session.towerId] : [];

  return (
    // .nst: نطاق CSS النموذج المعتمد (الصفحة التجريبية) — بنيته حرفياً:
    // بطاقات الإحصاء ثم row2: [المشتركين + تحصيل الفنيين | التقرير اليومي]
    <div className="nst nst-fill min-h-screen bg-ground p-4 min-[1051px]:p-[20px_22px_16px]" style={{ display: "grid", gap: 17, alignContent: "start" }}>
      <StatCards initialReport={initialReport} towerIds={counterTowers} offices={towers} isAdmin={isAdmin} />
      {/* 🧪 مربّعُ رئيسيّة النموذج (إدارة الفنيّين + سجلّ الوصولات) — null في الإنتاج، يظهر تحت علَم التجربة وحدَه */}
      <TrialFmCard />
      {/* نقطة الكسر 1051px نفسها المستعملة في طبقة التكيّف مع الارتفاع */}
      <div className="row2 max-[1050px]:!grid-cols-1">
        <SubscribersBoard />
        <DailyReportCard isAdmin={isAdmin} towers={towers} towerUsers={towerUsers} initial={initialReport} />
      </div>
    </div>
  );
}
