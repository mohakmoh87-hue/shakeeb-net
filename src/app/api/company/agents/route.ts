import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession } from "@/lib/companyAuth";
import { getSubsVisibleToCompany } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// قائمةُ الوكلاء لبوّابة الشركة (لاختيار وكيلٍ لعرض مشتركيه) — مشروطةٌ بعلَم المالك (مطفأٌ افتراضاً).
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (s.role !== "manager") return NextResponse.json({ enabled: false, agents: [] }); // للمدير حصراً
  if (!(await getSubsVisibleToCompany())) return NextResponse.json({ enabled: false, agents: [] });
  const agents = await prisma.agent.findMany({ where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ enabled: true, agents });
}
