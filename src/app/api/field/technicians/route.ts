import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { resolveFieldOffice } from "@/lib/field";

export const dynamic = "force-dynamic";

// قائمة فنيّي المكتب (لعرضها واختيارها عند توجيه البطاقات) — متاحة لأي جلسة.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const reqOffice = new URL(request.url).searchParams.get("officeId");
  const officeId = resolveFieldOffice(session, reqOffice ? Number(reqOffice) : null);
  const technicians = await prisma.technician.findMany({
    where: { towerId: officeId ?? null, isDeleted: false },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ technicians, officeId });
}

// إضافة فني للمكتب (صلاحية إدارة الفنيين).
// يُنشئ تلقائياً حساب مصروفات/مقبوضات باسمه (موظف) في نفس مكتبه ويربطه به.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "اسم الفني مطلوب" }, { status: 400 });
  const officeId = resolveFieldOffice(g.session, b?.officeId != null ? Number(b.officeId) : null);

  // حساب موظف باسم الفني في نفس المكتب (يظهر في قائمة حسابات المكتب وحسابات المدير)
  const account = await prisma.account.create({
    data: { name, typeName: "فني", isEmployee: true, towerId: officeId ?? null },
  });
  const created = await prisma.technician.create({
    data: { name, phone: String(b?.phone ?? "").trim() || null, towerId: officeId ?? null, accountId: account.id },
  });
  return NextResponse.json(created, { status: 201 });
}

// حذف فني (حذف منطقي) — يحذف معه حساب الموظف المرتبط — صلاحية إدارة الفنيين
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const tech = await prisma.technician.findUnique({ where: { id }, select: { accountId: true } });
  await prisma.technician.updateMany({ where: { id, isDeleted: false }, data: { isDeleted: true } });
  if (tech?.accountId) {
    await prisma.account.updateMany({ where: { id: tech.accountId, isDeleted: false }, data: { isDeleted: true } });
  }
  return NextResponse.json({ ok: true });
}
