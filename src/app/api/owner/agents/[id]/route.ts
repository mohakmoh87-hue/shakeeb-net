import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner, confirmOwnerPassword } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { encryptSecret } from "@/lib/secretbox";
import { sendMail, mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  officeCap: z.coerce.number().int().min(0).optional(),
  maxManagers: z.coerce.number().int().min(1).optional(),
  maxUsers: z.coerce.number().int().min(0).optional(),
  maxTechnicians: z.coerce.number().int().min(0).optional(),
  maxSubscribers: z.coerce.number().int().min(0).optional(),
  addMonths: z.coerce.number().int().optional(), // تمديد الاشتراك بعدد أشهر (يُضاف للانتهاء الحالي أو من الآن)
  setExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح").optional(), // تمديد إلى تاريخ محدَّد YYYY-MM-DD
  clearExpiry: z.boolean().optional(), // إزالة تاريخ الانتهاء (بلا انتهاء)
  approve: z.boolean().optional(), // موافقة المالك على تفعيل الوكيل (التجريبي)
  odooSlaSendAllowed: z.boolean().optional(), // إذن «رسائل أودو التلقائيّة» لهذا الوكيل (الميزة ٢)
  // أ-٢٣ · حصّةُ المالك: **كم مكتباً** من مكاتب هذا الوكيل يُسمح له بأكثر من لوحة ساس.
  // صفر = الوضعُ الحاليّ (لا خيارَ يظهر للوكيل). طلبُ محمد 2026-08-13.
  multiSasOffices: z.coerce.number().int().min(0).max(50).optional(),
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
  if (d.maxManagers != null) data.maxManagers = d.maxManagers;
  if (d.maxUsers != null) data.maxUsers = d.maxUsers;
  if (d.maxTechnicians != null) data.maxTechnicians = d.maxTechnicians;
  if (d.maxSubscribers != null) data.maxSubscribers = d.maxSubscribers;
  if (d.approve) data.approved = true; // تفعيل الوكيل التجريبي
  if (d.odooSlaSendAllowed != null) data.odooSlaSendAllowed = d.odooSlaSendAllowed;
  // ===== أ-٢٣ · الحصّة =====
  // ⚠️ تخفيضُ الحصّة **لا يُطبَّق بحذف لوحاتٍ زائدة**، بخلاف نمط `odooSlaSendAllowed` أدناه:
  // حذفُ لوحةٍ يُسقط مشتركيها إلى بيانات ساس المكتب ⇒ **تفعيلٌ على مُخدِّمٍ خطأ** بلا أن يُنبَّه
  // أحد. فالتخفيضُ تحت المستهلَك **يُرفض برسالةٍ تُسمّي المكاتب**، والمالكُ يُقرّر ما يُزال.
  if (d.multiSasOffices != null) {
    const { multiSasQuota } = await import("@/lib/sasPanel");
    const q = await multiSasQuota(agentId);
    if (d.multiSasOffices < q.used) {
      const names = await prisma.tower.findMany({
        where: { id: { in: q.usedTowerIds } }, select: { name: true },
      });
      return NextResponse.json({
        error: `لا يمكن التخفيض إلى ${d.multiSasOffices}: يستعمل الوكيلُ الحصّةَ في ${q.used} مكتباً (${names.map((n) => n.name ?? "—").join(" · ")}). أزِل اللوحةَ الثانية من مكتبٍ أوّلاً — والإزالةُ من صفحة المكاتب كي لا يُفعَّل مشتركوها على مُخدِّمٍ خطأ.`,
      }, { status: 400 });
    }
    data.multiSasOffices = d.multiSasOffices;
  }
  // سحبُ الإذن يقطع فعلاً لا اسماً: تُطفأ مفاتيح كلّ مكاتبه ويُفرَّغ طابور رسائل المشتركين —
  // وإلّا واصل العامل الإرسال ولم يبقَ للوكيل زرٌّ يُطفئه (اصطاده تدقيقٌ عدائيّ 2026-08-09).
  if (d.odooSlaSendAllowed === false) {
    const towers = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
    await prisma.tower.updateMany({ where: { agentId }, data: { odooSlaAuto: "0", odooSlaArmedAt: null } });
    if (towers.length) {
      const boards = await prisma.taskBoard.findMany({
        where: { towerId: { in: towers.map((t) => t.id) } }, select: { id: true },
      });
      const lists = boards.length
        ? await prisma.taskList.findMany({ where: { boardId: { in: boards.map((b) => b.id) } }, select: { id: true } })
        : [];
      if (lists.length) {
        await prisma.taskCard.updateMany({
          where: { listId: { in: lists.map((l) => l.id) }, slaWaQueuedAt: { not: null }, slaWaSentAt: null },
          data: { slaWaQueuedAt: null, slaWaError: "أُلغيت — سُحب إذن إرسال رسائل أودو" },
        });
      }
    }
  }
  // تاريخ الانتهاء: إزالة، أو تمديد بأشهر (من الانتهاء الحالي/الآن)، أو ضبط تاريخ محدَّد
  let renewedTo: Date | null = null;
  if (d.clearExpiry) { data.planExpiry = null; data.isTrial = false; }
  else if (d.addMonths != null && d.addMonths !== 0) {
    const base = agent.planExpiry && agent.planExpiry.getTime() > Date.now() ? agent.planExpiry.getTime() : Date.now();
    data.planExpiry = new Date(base + d.addMonths * 30 * 24 * 3600 * 1000);
    data.isTrial = false; // التمديد يحوّله لحساب عادي
    renewedTo = data.planExpiry as Date;
  } else if (d.setExpiry) {
    // نهاية اليوم المختار (بغداد ≈ +03) كي يبقى الاشتراك سارياً طوال ذلك اليوم
    const dt = new Date(`${d.setExpiry}T23:59:59+03:00`);
    if (!isNaN(dt.getTime())) { data.planExpiry = dt; data.isTrial = false; renewedTo = dt; }
  }

  if (Object.keys(data).length > 0) await prisma.agent.update({ where: { id: agentId }, data });

  // التجديد/التمديد يصفّر علامة التنبيه — لتعمل تنبيهات الدورة القادمة من جديد
  if (d.clearExpiry || renewedTo) {
    await prisma.systemSetting.deleteMany({ where: { type: `planWarn:${agentId}` } }).catch(() => {});
  }

  // إيميل التجديد للوكيل (على بريده backupEmail) — صامت، لا يُعطّل التعديل
  if (renewedTo && agent.backupEmail && mailerConfigured()) {
    const dateStr = renewedTo.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    void sendMail({
      to: agent.backupEmail,
      subject: `✅ تم تجديد اشتراكك — ${agent.name ?? "SHAKEEB"}`,
      text: `مرحباً ${agent.name ?? ""}،\n\nتم تجديد اشتراكك في النظام حتى تاريخ ${dateStr}.\n\nشكراً لك.`,
    }).catch(() => {});
  }

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
    if (d.managerPassword != null) { mdata.password = await hashPassword(d.managerPassword); mdata.plainPassword = encryptSecret(d.managerPassword); }
    if (Object.keys(mdata).length > 0) await prisma.user.update({ where: { id: manager.id }, data: mdata });
  }

  return NextResponse.json({ ok: true });
}

// حذف وكيل نهائياً: تُمحى كل بياناته من قاعدة البيانات.
// عملية حساسة: تتطلب إدخال كلمة سر السوبر أدمن (المالك) للتأكيد.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  if (!(await confirmOwnerPassword(g.session.userId, body?.ownerPassword))) {
    return NextResponse.json({ error: "كلمة سر السوبر أدمن مطلوبة وغير صحيحة — لا يمكن حذف الوكيل بدونها" }, { status: 403 });
  }
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
