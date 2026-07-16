import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TopBar from "@/components/TopBar";
import MobileNav from "@/components/MobileNav";
import WhatsAppMonitor from "@/components/WhatsAppMonitor";
import ReminderPrompt from "@/components/ReminderPrompt";
import CompletionNotifier from "@/components/CompletionNotifier";
import HybridOnboarding from "@/components/HybridOnboarding";

// غلاف الصفحات المحمية: شريط أدوات علوي + المحتوى
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // النظام الهجين نشط إن وُجدت حاسبة معتمَدة ومتصلة (نبضة خلال 60ث)؛ عندها لا يظهر إشعار الإعداد
  let hybridActive = true;
  if (!session.isAdmin) {
    const w = await prisma.hybridWorker.findFirst({
      where: { approved: true, lastSeen: { gte: new Date(Date.now() - 60_000) } },
      select: { id: true },
    });
    hybridActive = !!w;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        fullName={session.fullName}
        roleLabel={session.isAdmin ? "مدير النظام" : "مستخدم"}
      />
      {/* تنقّل الهاتف (يظهر على الشاشات الصغيرة فقط) */}
      <MobileNav
        fullName={session.fullName}
        roleLabel={session.isAdmin ? "مدير النظام" : "مستخدم"}
      />

      <WhatsAppMonitor />
      <ReminderPrompt />
      <CompletionNotifier />
      {/* إشعار إعداد الحاسبة ضمن النظام الهجين — لغير المدير حتى يُنصَّب الوكيل */}
      <HybridOnboarding isAdmin={!!session.isAdmin} hybridActive={hybridActive} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
