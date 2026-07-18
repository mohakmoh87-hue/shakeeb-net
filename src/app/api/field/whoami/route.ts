import { NextResponse } from "next/server";
import { getSession, getTechSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// من أنا في تطبيق إدارة الفنيين؟ يميّز الدور: مدير / موظف مكتب / فني.
export async function GET() {
  const user = await getSession();
  if (user) {
    return NextResponse.json({
      role: can(user, "field.manage") ? "manager" : "office",
      name: user.fullName, towerId: user.towerId, isAdmin: user.isAdmin,
      canAddTech: can(user, "field.manage"),
    });
  }
  const tech = await getTechSession();
  if (tech) {
    return NextResponse.json({
      role: "technician",
      technicianId: tech.technicianId, name: tech.name, username: tech.username, towerId: tech.towerId,
      canAddTech: false,
    });
  }
  return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
}
