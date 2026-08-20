import { redirect } from "next/navigation";
import { getSession, getTechSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AppShell from "@/components/shell/AppShell";
import ReminderPrompt from "@/components/ReminderPrompt";
import CompletionNotifier from "@/components/CompletionNotifier";
import StandaloneLock from "@/components/StandaloneLock";
import PlanBanner from "@/components/PlanBanner";
import ClientErrorReporter from "@/components/ClientErrorReporter";
import AppBarHandle from "@/components/AppBarHandle";
import InternalMsgHost from "@/components/InternalMsgHost";

// غلاف الصفحات المحمية: شريط أدوات علوي + المحتوى
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    // الفني: غلاف مجرّد بلا شريط علوي/سفلي — تطبيق إدارة الفنيين المركّز فقط
    const tech = await getTechSession();
    if (tech) {
      return (
        <div className="flex min-h-screen flex-col">
          <PlanBanner agentId={tech.agentId ?? null} />
          <ClientErrorReporter />
          <AppBarHandle />
          {/* 📬 الرسائل الداخليّة المنبثقة — تظهر للفنيّ فوق بطاقاته ولا تُغلق إلّا بـX */}
          <InternalMsgHost />
          <main className="flex-1">{children}</main>
        </div>
      );
    }
    redirect("/login");
  }
  // مالك النظام لا يدخل صفحات المستأجر — يُوجَّه للوحته
  if (session.isOwner) redirect("/owner");

  // علامة الوكيل (تظهر بأعلى الشاشة لكل الوكيل)
  let brand = "SHAKEEB";
  if (session.agentId != null) {
    const agent = await prisma.agent.findUnique({ where: { id: session.agentId }, select: { name: true } });
    if (agent?.name) brand = agent.name;
  }

  return (
    <div className="min-h-screen bg-ground">
      {/* مراقبات الموقع — تُخفى في التطبيق المثبّت (standalone).
          مراقب واتساب المنبثق القديم أُزيل (قرار محمد): حالة الواتساب صارت شريحة
          بترويسة جدول المشتركين، والضغط عليها يفتح صفحة ربط QR */}
      <div data-site-chrome>
        <ReminderPrompt />
        <CompletionNotifier />
      </div>

      {/* في التطبيق المثبّت: يحصر التنقّل بإدارة الفنيين لأي حساب */}
      <StandaloneLock />

      {/* 📬 الرسائل الداخليّة المنبثقة — للمستخدم والمدير في كلّ صفحة (والشاشة الرئيسيّة ضمناً) */}
      <InternalMsgHost />

      {/* 🧪 مقبضُ شريط الخيارات — لا يظهر إلّا تحت علَم التجربة وفي صفحةٍ تحمل شريطاً فعلاً */}
      <AppBarHandle />

      {/* مُبلّغُ أخطاء الواجهة — كلُّ انهيارٍ في أيّ متصفّحٍ يُسجَّل في سجلّ التدقيق */}
      <ClientErrorReporter />

      {/* تنبيه انتهاء الاشتراك — خارج غلاف الموقع ليظهر في التطبيق المثبّت أيضاً */}
      <PlanBanner agentId={session.agentId ?? null} />

      {/* غلاف الطراز الجديد: شريط جانبي (حاسبة) + شريط علوي ودرج وشريط سفلي (هاتف).
          عناصر الغلاف داخله موسومة data-site-chrome فتختفي في التطبيق المثبّت. */}
      <AppShell
        brand={brand}
        fullName={session.fullName}
        roleLabel={session.isAdmin ? "مدير النظام" : "مستخدم"}
      >
        {children}
      </AppShell>
    </div>
  );
}
