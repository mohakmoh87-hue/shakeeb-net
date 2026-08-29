import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPortalEnabled } from "@/lib/appConfig";
import { getCompanySession } from "@/lib/companyAuth";
import CompanyLogin from "./CompanyLogin";
import CompanyDashboard from "./CompanyDashboard";

// 🏢 بوّابةُ سوبر سيل الحقيقيّة (القطعة ٥، طلبُ محمد 2026-08-29) — حلّت محلَّ عرض الـ120 وكيلاً الوهميّ.
// معزولةٌ: تُحرَس بجلسة الشركة (kabina_company) لا جلسةِ المستخدم؛ 404 حين يُطفئ المالكُ البوّابة.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SupercellPage() {
  if (!(await getPortalEnabled())) notFound(); // 404 عند إطفاء البوّابة
  const session = await getCompanySession();
  return session ? <CompanyDashboard username={session.username} /> : <CompanyLogin />;
}
