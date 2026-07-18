import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  officeCap: z.coerce.number().int().min(0).optional(),
  addMonths: z.coerce.number().int().optional(), // تمديد الاشتراك بعدد أشهر (يُضاف للانتهاء الحالي أو من الآن)
  clearExpiry: z.boolean().optional(), // إزالة تاريخ الانتهاء (بلا انتهاء)
  approve: z.boolean().optional(), // موافقة المالك على تفعيل الوكيل (التجريبي)
  managerUsername: z.string().min(1).optional(), // تعديل يوزر مدير الوكيل
  managerPassword: z.string().min(4).optional(), // تعديل باسورد مدير الوكيل
});

// تعديل وكيل: الاسم، سقف المكاتب، تمديد الاشتراك
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  const agentId = Number(id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const d = parsed.data;

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.isDeleted) return NextResponse.json({ error: "الوكيل غير موجود" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (d.name != null) data.name = d.name;
  if (d.officeCap != null) data.officeCap = d.officeCap;
  if (d.approve) data.approved = true; // تفعيل الوكيل التجريبي
  if (d.clearExpiry) { data.planExpiry = null; data.isTrial = false; }
  else if (d.addMonths != null && d.addMonths !== 0) {
    const base = agent.planExpiry && agent.planExpiry.getTime() > Date.now() ? agent.planExpiry.getTime() : Date.now();
    data.planExpiry = new Date(base + d.addMonths * 30 * 24 * 3600 * 1000);
    data.isTrial = false; // التمديد يحوّله لحساب عادي
  }

  if (Object.keys(data).length > 0) await prisma.agent.update({ where: { id: agentId }, data });

  // تعديل بيانات دخول مدير الوكيل (أول أدمن للوكيل)
  if (d.managerUsername != null || d.managerPassword != null) {
    const manager = await prisma.user.findFirst({ where: { agentId, isAdmin: true, isOwner: false, isDeleted: false }, orderBy: { id: "asc" } });
    if (!manager) return NextResponse.json({ error: "لا مدير لهذا الوكيل" }, { status: 404 });
    const mdata: Record<string, unknown> = {};
    if (d.managerUsername != null && d.managerUsername !== manager.username) {
      const taken = await prisma.user.findUnique({ where: { username: d.managerUsername } });
      if (taken && taken.id !== manager.id) return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
      mdata.username = d.managerUsername;
    }
    if (d.managerPassword != null) { mdata.password = await hashPassword(d.managerPassword); mdata.plainPassword = d.managerPassword; }
    if (Object.keys(mdata).length > 0) await prisma.user.update({ where: { id: manager.id }, data: mdata });
  }

  return NextResponse.json({ ok: true });
}

// حذف وكيل نهائياً: تُمحى كل بياناته من قاعدة البيانات.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  const agentId = Number(id);
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return NextResponse.json({ error: "الوكيل غير موجود" }, { status: 404 });

  // مكاتب الوكيل (لحذف كل ما يرتبط بها)
  const towers = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
  const towerIds = towers.map((t) => t.id);

  // أبناء لوحات الفنيين (بطاقات/أعمدة/صور) تُحذف عبر علاقتها بمكاتب الوكيل
  if (towerIds.length) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM card_photos WHERE "cardId" IN (SELECT c.id FROM task_cards c JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]))`, towerIds,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM task_cards WHERE "listId" IN (SELECT l.id FROM task_lists l JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]))`, towerIds,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM task_lists WHERE "boardId" IN (SELECT id FROM task_boards WHERE "towerId" = ANY($1::int[]))`, towerIds,
    ).catch(() => {});
  }

  // كل الجداول التي فيها عمود towerId ⇒ حذف صفوف مكاتب الوكيل
  if (towerIds.length) {
    const towerTables: { table_name: string }[] = await prisma.$queryRawUnsafe(
      `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='towerId'`,
    );
    for (const { table_name } of towerTables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "towerId" = ANY($1::int[])`, towerIds).catch(() => {});
    }
  }

  // كل الجداول التي فيها عمود agentId (عدا agents نفسه) ⇒ حذف صفوف الوكيل
  const agentTables: { table_name: string }[] = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='agentId' AND table_name <> 'agents'`,
  );
  for (const { table_name } of agentTables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "agentId" = $1`, agentId).catch(() => {});
  }

  // قالب الوصل الخاص بالوكيل (مخزّن في system_settings بمفتاح receipt:{id})
  await prisma.$executeRawUnsafe(`DELETE FROM system_settings WHERE type = $1`, `receipt:${agentId}`).catch(() => {});

  // أخيراً حذف الوكيل نفسه
  await prisma.agent.delete({ where: { id: agentId } });
  return NextResponse.json({ ok: true });
}
