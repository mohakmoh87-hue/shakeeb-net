import { redirect } from "next/navigation";
import { getSession, getViewerSession } from "@/lib/auth";
import WatchBoard from "@/components/WatchBoard";

export const dynamic = "force-dynamic";

// 👁️ صفحةُ مستخدم المشاهدة — الصفحةُ الوحيدةُ التي يصلها (طلبُ محمد 2026-11-21).
// وغيرُ المشاهد لا شأنَ له بها: المستخدمُ العاديُّ يُردّ إلى شاشته لا إلى صفحة الدخول
// (وإلّا بدا لمن يفتح الرابطَ بالخطأ أنّ جلستَه انتهت)، والفنيُّ يردّه البروكسي أصلاً.
export default async function WatchPage() {
  const viewer = await getViewerSession();
  if (!viewer) redirect((await getSession()) ? "/dashboard" : "/login");
  return <WatchBoard />;
}
