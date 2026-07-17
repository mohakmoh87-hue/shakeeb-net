import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// غلاف لوحة مالك النظام — للمالك فقط
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isOwner) redirect("/dashboard");
  return <div className="min-h-screen bg-slate-100">{children}</div>;
}
