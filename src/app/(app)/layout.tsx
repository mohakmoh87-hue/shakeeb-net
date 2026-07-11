import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import MobileNav from "@/components/MobileNav";
import WhatsAppMonitor from "@/components/WhatsAppMonitor";
import ReminderPrompt from "@/components/ReminderPrompt";

// غلاف الصفحات المحمية: شريط أدوات علوي + المحتوى
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

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
      <main className="flex-1">{children}</main>
    </div>
  );
}
