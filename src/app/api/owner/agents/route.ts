import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// قائمة الوكلاء مع إحصاءاتهم وبيانات مديرهم (لمالك النظام)
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;

  const agents = await prisma.agent.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" } });
  const [towerCounts, userCounts, subCounts, managers] = await Promise.all([
    prisma.tower.groupBy({ by: ["agentId"], where: { isDeleted: false }, _count: true }),
    prisma.user.groupBy({ by: ["agentId"], where: { isDeleted: false, isOwner: false }, _count: true }),
    // عدد المشتركين لكل وكيل عبر مكاتبه
    prisma.$queryRawUnsafe<{ aid: number; c: bigint }[]>(
      `SELECT t."agentId" AS aid, count(s.id) c FROM subscribers s JOIN towers t ON t.id = s."towerId" WHERE s."isDeleted"=false AND t."agentId" IS NOT NULL GROUP BY 1`,
    ),
    // مدير كل وكيل (أول أدمن) — للعرض/التعديل
    prisma.user.findMany({
      where: { isOwner: false, isAdmin: true, isDeleted: false, agentId: { not: null } },
      select: { id: true, username: true, plainPassword: true, agentId: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const tc = new Map(towerCounts.map((t) => [t.agentId, t._count]));
  const uc = new Map(userCounts.map((u) => [u.agentId, u._count]));
  const sc = new Map(subCounts.map((s) => [Number(s.aid), Number(s.c)]));
  const mgr = new Map<number, { id: number; username: string; plainPassword: string | null }>();
  for (const m of managers) if (m.agentId != null && !mgr.has(m.agentId)) mgr.set(m.agentId, { id: m.id, username: m.username, plainPassword: m.plainPassword });

  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id, name: a.name, officeCap: a.officeCap,
      planExpiry: a.planExpiry, isTrial: a.isTrial, approved: a.approved,
      officeCount: tc.get(a.id) ?? 0, userCount: uc.get(a.id) ?? 0,
      subscriberCount: sc.get(a.id) ?? 0,
      manager: mgr.get(a.id) ?? null,
      expired: a.planExpiry ? a.planExpiry.getTime() < Date.now() : false,
    })),
  });
}

const schema = z.object({
  name: z.string().min(1, "اسم الوكيل مطلوب"),
  officeCap: z.coerce.number().int().min(0).default(1),
  planMonths: z.coerce.number().int().min(0).default(0), // 0 = بلا انتهاء
  isTrial: z.coerce.boolean().default(false),
  managerFullName: z.string().min(1, "اسم المدير مطلوب"),
  managerUsername: z.string().min(1, "اسم مستخدم المدير مطلوب"),
  managerPassword: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
});

// إنشاء وكيل جديد + حساب مديره الأول
export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const d = parsed.data;

  // منع تكرار اسم المستخدم عبر كامل النظام
  const exists = await prisma.user.findUnique({ where: { username: d.managerUsername } });
  if (exists) return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });

  const planExpiry = d.planMonths > 0 ? new Date(Date.now() + d.planMonths * 30 * 24 * 3600 * 1000) : null;

  const created = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: { name: d.name, officeCap: d.officeCap, isTrial: d.isTrial, planExpiry },
    });
    // المدير الأول للوكيل: أدمن كامل الصلاحيات ضمن هذا الوكيل
    const manager = await tx.user.create({
      data: {
        fullName: d.managerFullName, username: d.managerUsername,
        password: await hashPassword(d.managerPassword), plainPassword: d.managerPassword,
        role: "ADMIN", isAdmin: true, isOwner: false, agentId: agent.id, isActive: true,
      },
    });
    return { agent, managerId: manager.id };
  });

  return NextResponse.json({ ok: true, agentId: created.agent.id }, { status: 201 });
}
