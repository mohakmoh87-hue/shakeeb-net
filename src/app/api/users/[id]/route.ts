import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { usernameTaken } from "@/lib/usernameTaken";

// أسماءٌ محجوزة للنظام (نفس قائمة الإنشاء) — لا يُسمَّى بها مستخدمٌ ولا يُعاد تسميته إليها
const RESERVED_USERNAMES = new Set(["scheduler", "sync-report", "sync", "system", "worker"]);

const schema = z.object({
  fullName: z.string().min(1, "الاسم الكامل مطلوب"),
  username: z.string().min(1, "اسم المستخدم مطلوب")
    .refine((v) => !RESERVED_USERNAMES.has(v.trim().toLowerCase()), "اسم المستخدم محجوز للنظام — اختر غيره"),
  password: z.string().optional(), // فارغ = عدم التغيير
  isAdmin: z.coerce.boolean().default(false),
  permissions: z.array(z.string()).default([]),
  // مديرٌ بصلاحيّاتٍ محدَّدة: قائمةُ **منعٍ** تسبق كلَّ منح (فارغةٌ = لا منع)
  deniedPermissions: z.array(z.string()).default([]),
  // البند ١ · حسابٌ منفصلٌ لمستخدمٍ يشارك مكتباً مع غيره
  separateAccount: z.boolean().optional(),
  // 👁️ نوعُ المشاهدة فقط + نطاقُه
  viewOnly: z.coerce.boolean().default(false),
  viewAllOffices: z.coerce.boolean().default(false),
  towerId: z.coerce.number().nullable().optional(),
  isActive: z.coerce.boolean().default(true),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { password, permissions, deniedPermissions, ...rest } = parsed.data;

  // عزل المستأجر: لا يُعدَّل إلا مستخدم يتبع وكيل المدير (وليس مالك النظام)
  const target = await prisma.user.findUnique({ where: { id: Number(id) }, select: { agentId: true, isOwner: true, username: true, viewOnly: true } });
  if (!target || target.isOwner || target.agentId !== (g.session?.agentId ?? null)) {
    return NextResponse.json({ error: "المستخدم لا يتبع حسابك" }, { status: 403 });
  }
  if (rest.username !== target.username && (await usernameTaken(rest.username, { userId: Number(id) }))) {
    return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
  }
  if (rest.towerId != null) {
    const t = await prisma.tower.findFirst({ where: { id: rest.towerId, agentId: g.session?.agentId ?? -1, isDeleted: false }, select: { id: true } });
    if (!t) return NextResponse.json({ error: "المكتب المحدّد لا يتبع حسابك" }, { status: 403 });
  }

  // 👁️ نفسُ حرسِ الإنشاء: المشاهدُ بلا إدارةٍ وبلا صلاحيّةٍ مهما أُرسل، ونطاقُ «مكتبه» يلزمه مكتب
  if (rest.viewOnly) {
    rest.isAdmin = false;
    permissions.length = 0;
    deniedPermissions.length = 0;
    if (!rest.viewAllOffices && rest.towerId == null) {
      return NextResponse.json({ error: "مستخدمُ المشاهدة بنطاق «مكتبه» يلزمه اختيارُ مكتب" }, { status: 400 });
    }
  } else {
    rest.viewAllOffices = false;
  }
  // 🔴 تغييرُ النوع يُبطل الجلسةَ القائمة فوراً: جلسةُ المستخدم ليست جلسةَ مشاهدٍ ولا العكس،
  //    فمستخدمٌ حُوِّل إلى مشاهدٍ كانت كعكتُه القديمة تُبقيه بكامل صلاحيّاته **سنةً**.
  //    ورمزٌ **جديد** لا تصفيرٌ: الفارغُ يُلغي الفحصَ في `getSession` فيُبقي القديمَ صالحاً.
  const typeChanged = rest.viewOnly !== target.viewOnly;

  const updated = await prisma.user.update({
    where: { id: Number(id) },
    data: {
      ...rest,
      permissions: permissions.join(","),
      deniedPermissions: deniedPermissions.join(",") || null,
      ...(password && password.length >= 4 ? { password: await hashPassword(password) } : {}),
      ...(typeChanged ? { sessionToken: crypto.randomUUID() } : {}),
    },
    select: { id: true, fullName: true, username: true, isAdmin: true, permissions: true, towerId: true, isActive: true, viewOnly: true, viewAllOffices: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const uid = Number(id);
  if (uid === g.session?.userId) {
    return NextResponse.json({ error: "لا يمكنك حذف حسابك الحالي" }, { status: 400 });
  }
  // عزل المستأجر: لا يُحذف إلا مستخدم يتبع وكيل المدير (وليس مالك النظام)
  const target = await prisma.user.findUnique({ where: { id: uid }, select: { agentId: true, isOwner: true } });
  if (!target || target.isOwner || target.agentId !== (g.session?.agentId ?? null)) {
    return NextResponse.json({ error: "المستخدم لا يتبع حسابك" }, { status: 403 });
  }
  // حذف نهائي من قاعدة البيانات (لإمكانية إعادة إضافة نفس اليوزر لاحقاً)
  await prisma.$transaction([
    prisma.auditLog.updateMany({ where: { userId: uid }, data: { userId: null } }),
    prisma.user.delete({ where: { id: uid } }),
  ]);
  return NextResponse.json({ ok: true });
}
