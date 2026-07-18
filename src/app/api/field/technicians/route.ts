import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { guard, ownsTower } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { resolveFieldOffice } from "@/lib/field";

export const dynamic = "force-dynamic";

// اسم المستخدم فريد على مستوى النظام كلّه (يُفحص ضد المستخدمين والفنيين)
async function usernameTaken(username: string, exceptTechId?: number): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (u) return true;
  const t = await prisma.technician.findFirst({
    where: { username, ...(exceptTechId ? { NOT: { id: exceptTechId } } : {}) },
    select: { id: true },
  });
  return !!t;
}

// قائمة فنيّي المكتب. الحقول الحسّاسة (الراتب/الرمز/إعدادات الدوام) تُكشف للمدير فقط.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const reqOffice = new URL(request.url).searchParams.get("officeId");
  const officeId = resolveFieldOffice(session, reqOffice ? Number(reqOffice) : null);
  const isManager = can(session, "field.manage");
  const rows = await prisma.technician.findMany({
    where: { towerId: officeId ?? null, isDeleted: false },
    orderBy: { id: "asc" },
  });
  const technicians = rows.map((t) => {
    const base = { id: t.id, name: t.name, phone: t.phone, towerId: t.towerId, username: t.username };
    if (!isManager) return base;
    // بيانات المدير الكاملة (بلا هاش الرمز)
    return {
      ...base, plainCode: t.plainCode, salary: t.salary,
      shiftStart: t.shiftStart, shiftEnd: t.shiftEnd, entryGraceMin: t.entryGraceMin, exitGraceMin: t.exitGraceMin,
      lateRatePerMin: t.lateRatePerMin, overtimeRatePerMin: t.overtimeRatePerMin, paidLeavesPerMonth: t.paidLeavesPerMonth,
    };
  });
  return NextResponse.json({ technicians, officeId, isManager });
}

// حقول الفني القابلة للضبط
function readFields(b: Record<string, unknown>) {
  const num = (v: unknown) => (v == null || v === "" ? null : Math.max(0, Math.round(Number(v)) || 0));
  const str = (v: unknown) => (v == null ? null : String(v).trim() || null);
  return {
    phone: str(b.phone), salary: num(b.salary),
    shiftStart: str(b.shiftStart), shiftEnd: str(b.shiftEnd),
    entryGraceMin: num(b.entryGraceMin) ?? 0, exitGraceMin: num(b.exitGraceMin) ?? 0,
    lateRatePerMin: num(b.lateRatePerMin) ?? 0, overtimeRatePerMin: num(b.overtimeRatePerMin) ?? 0,
    paidLeavesPerMonth: num(b.paidLeavesPerMonth) ?? 0,
  };
}

// إضافة فني (المدير فقط) — يُنشئ حساب موظف باسمه ويربطه، ويضبط بيانات الدخول والحضور والراتب.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  const username = String(b?.username ?? "").trim();
  const code = String(b?.code ?? "").trim();
  if (!name) return NextResponse.json({ error: "اسم الفني مطلوب" }, { status: 400 });
  if (!username || !/^[A-Za-z0-9_.-]{3,}$/.test(username)) return NextResponse.json({ error: "اسم مستخدم صالح مطلوب (3 أحرف/أرقام على الأقل، إنجليزي)" }, { status: 400 });
  if (code.length < 4) return NextResponse.json({ error: "رمز الدخول 4 خانات على الأقل" }, { status: 400 });
  if (await usernameTaken(username)) return NextResponse.json({ error: "اسم المستخدم مستخدَم مسبقاً — اختر غيره" }, { status: 400 });

  const officeId = resolveFieldOffice(g.session!, b?.officeId != null ? Number(b.officeId) : null);
  // عزل: المكتب يجب أن يتبع وكيل المستخدم
  if (officeId != null && !(await ownsTower(g.session, officeId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const account = await prisma.account.create({
    data: { name, typeName: "فني", isEmployee: true, towerId: officeId ?? null },
  });
  const created = await prisma.technician.create({
    data: {
      name, username, code: await hashPassword(code), plainCode: code,
      agentId: g.session?.agentId ?? null, towerId: officeId ?? null, accountId: account.id,
      ...readFields(b ?? {}),
    },
  });
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}

// تعديل بيانات/إعدادات فني (المدير فقط)
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const tech = await prisma.technician.findUnique({ where: { id } });
  if (!tech || tech.isDeleted || !(await ownsTower(g.session, tech.towerId))) {
    return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  }
  const data: Record<string, unknown> = { ...readFields(b ?? {}) };
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.username === "string" && b.username.trim() && b.username.trim() !== tech.username) {
    const un = b.username.trim();
    if (!/^[A-Za-z0-9_.-]{3,}$/.test(un)) return NextResponse.json({ error: "اسم مستخدم غير صالح" }, { status: 400 });
    if (await usernameTaken(un, id)) return NextResponse.json({ error: "اسم المستخدم مستخدَم مسبقاً" }, { status: 400 });
    data.username = un;
  }
  if (typeof b.code === "string" && b.code.trim()) {
    if (b.code.trim().length < 4) return NextResponse.json({ error: "رمز الدخول 4 خانات على الأقل" }, { status: 400 });
    data.code = await hashPassword(b.code.trim()); data.plainCode = b.code.trim();
  }
  await prisma.technician.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

// حذف فني نهائياً (فيزيائياً) — المدير فقط. يُحذف معه حسابه وحضوره.
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const tech = await prisma.technician.findUnique({ where: { id }, select: { accountId: true, towerId: true } });
  if (!tech || !(await ownsTower(g.session, tech.towerId))) {
    return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.attendance.deleteMany({ where: { technicianId: id } });
    await tx.technician.delete({ where: { id } });
    // حساب الموظف المرتبط: يُحذف فيزيائياً إن لا حركات مالية عليه (حماية التقارير)، وإلا يُخفى
    if (tech.accountId) {
      const moneyRef = await tx.moneyTx.count({ where: { accountId: tech.accountId } });
      if (moneyRef === 0) await tx.account.delete({ where: { id: tech.accountId } }).catch(() => {});
      else await tx.account.update({ where: { id: tech.accountId }, data: { isDeleted: true } }).catch(() => {});
    }
  });
  return NextResponse.json({ ok: true });
}
