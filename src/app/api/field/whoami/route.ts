import { NextResponse } from "next/server";
import { getSession, getTechSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 📷 إذنُ صورة الإنجاز لوكيل الجلسة — يُقرأ هنا لا في مسار اللوحة: اللوحةُ تُستطلَع
// كلَّ عشرين ثانيةً وهذا يُقرأ مرّةً عند فتح الصفحة (الإذنُ يتغيّر بقرارِ مالكٍ نادر).
async function cardPhotoAllowed(agentId: number | null | undefined): Promise<boolean> {
  if (agentId == null) return false;
  try {
    const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { cardPhotoAllowed: true } });
    return !!a?.cardPhotoAllowed;
  } catch (e) {
    // لا يُبتلَع بصمت: صلاحيّةُ العمود الناقصةُ على حاسبة المكتب أمات ميزةَ أودو شهراً
    console.error("[field/whoami] تعذّر قراءة إذن صورة الإنجاز:", e instanceof Error ? e.message : e);
    return false;
  }
}

// من أنا في تطبيق إدارة الفنيين؟ يميّز الدور: مدير / موظف مكتب / فني.
export async function GET() {
  const user = await getSession();
  if (user) {
    return NextResponse.json({
      role: can(user, "field.manage") ? "manager" : "office",
      name: user.fullName, towerId: user.towerId, isAdmin: user.isAdmin,
      canAddTech: can(user, "field.manage"),
      cardPhoto: await cardPhotoAllowed(user.agentId),
    });
  }
  const tech = await getTechSession();
  if (tech) {
    return NextResponse.json({
      role: "technician",
      technicianId: tech.technicianId, name: tech.name, username: tech.username, towerId: tech.towerId,
      canAddTech: false,
      cardPhoto: await cardPhotoAllowed(tech.agentId),
    });
  }
  return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
}
