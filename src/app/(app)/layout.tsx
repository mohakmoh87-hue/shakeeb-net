import { redirect } from "next/navigation";
import { getSession, getTechSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TopBar from "@/components/TopBar";
import MobileNav from "@/components/MobileNav";
import WhatsAppMonitor from "@/components/WhatsAppMonitor";
import ReminderPrompt from "@/components/ReminderPrompt";
import CompletionNotifier from "@/components/CompletionNotifier";

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
          <main className="flex-1">{children}</main>
        </div>
      );
    }
    redirect("/login");
  }
  // مالك النظام لا يدخل صفحات المستأجر — يُوجَّه للوحته
  if (session.isOwner) redirect("/owner");

  // علامة الوكيل (تظهر بأعلى الشاشة لكل الوكيل)
  let brand = "شكيب نت";
  if (session.agentId != null) {
    const agent = await prisma.agent.findUnique({ where: { id: session.agentId }, select: { name: true } });
    if (agent?.name) brand = agent.name;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        brand={brand}
        fullName={session.fullName}
        roleLabel={session.isAdmin ? "مدير النظام" : "مستخدم"}
      />
      {/* تنقّل الهاتف (يظهر على الشاشات الصغيرة فقط) */}
      <MobileNav
        brand={brand}
        fullName={session.fullName}
        roleLabel={session.isAdmin ? "مدير النظام" : "مستخدم"}
      />

      <WhatsAppMonitor />
      <ReminderPrompt />
      <CompletionNotifier />
      <main className="flex-1">{children}</main>
    </div>
  );
}
