import type { Metadata } from "next";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import AppAdminLogin from "./AppAdminLogin";
import AppAdminDashboard from "./AppAdminDashboard";

// 📱 أدمن تطبيق المشترك — دخولٌ مستقلٌّ (kabina_appadmin) بحسابٍ يُنشئه المالك. معزولٌ تماماً
// عن جلسة المستخدم وجلسة الشركة. طلبُ محمد 2026-09-01.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppAdminPage() {
  const session = await getAppAdminSession();
  return session ? <AppAdminDashboard username={session.username} /> : <AppAdminLogin />;
}
