import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { managerBalances, ensureManagerAccounts } from "@/lib/managers";

export const dynamic = "force-dynamic";

// مدراء الوكيل وأرصدتهم — لصفحة حسابات المدير.
// المدير هوية مالية لا حساب دخول (قرار محمد 2026-08-03).
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const towerIds = await agentTowerIds(g.session);
  const managers = await managerBalances(g.session.agentId, towerIds);
  return NextResponse.json({ managers });
}

const schema = z.object({ name: z.string().min(1, "اسم المدير مطلوب").max(80) });

// إنشاء مدير: يُنشأ له حساب مصروف/مقبوض في **كل** مكاتب وكيله تلقائياً
export async function POST(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const name = parsed.data.name.trim();

  const dup = await prisma.manager.findFirst({ where: { agentId, isDeleted: false, name }, select: { id: true } });
  if (dup) return NextResponse.json({ error: "يوجد مدير بهذا الاسم" }, { status: 409 });

  const towerIds = await agentTowerIds(g.session);
  const created = await prisma.manager.create({ data: { agentId, name } });
  const made = await ensureManagerAccounts(created.id, name, towerIds);
  await prisma.auditLog.create({
    data: {
      userId: g.session.userId, action: "MANAGER_CREATE", entity: "manager", entityId: String(created.id),
      details: `إنشاء مدير «${name}» + ${made} حساب مصروف/مقبوض في مكاتب الوكيل`,
    },
  }).catch(() => {});
  return NextResponse.json({ ok: true, id: created.id, accountsCreated: made }, { status: 201 });
}

// حذف مدير (ناعم) — حساباته وحركاتها تبقى كما هي، فلا يتغيّر أي رقم مالي
export async function DELETE(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });
  const res = await prisma.manager.updateMany({
    where: { id, agentId: g.session.agentId ?? -1, isDeleted: false }, // عزل
    data: { isDeleted: true },
  });
  if (!res.count) return NextResponse.json({ error: "المدير غير موجود" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
