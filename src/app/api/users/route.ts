import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { usernameTaken } from "@/lib/usernameTaken";

// أسماءٌ محجوزة للنظام: تُستعمل في createdByUser للرسائل الآليّة (تقرير المدير/المزامنة)،
// فتسميةُ مستخدمٍ بها كانت تُستغَلّ لرؤية رسائل وكلاءٍ آخرين (تدقيق عدائيّ 2026-08-09).
const RESERVED_USERNAMES = new Set(["scheduler", "sync-report", "sync", "system", "worker"]);

const schema = z.object({
  fullName: z.string().min(1, "الاسم الكامل مطلوب"),
  username: z.string().min(1, "اسم المستخدم مطلوب")
    .refine((v) => !RESERVED_USERNAMES.has(v.trim().toLowerCase()), "اسم المستخدم محجوز للنظام — اختر غيره"),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
  isAdmin: z.coerce.boolean().default(false),
  permissions: z.array(z.string()).default([]),
  // مديرٌ بصلاحيّاتٍ محدَّدة: قائمةُ **منعٍ** تسبق كلَّ منح (فارغةٌ = لا منع)
  deniedPermissions: z.array(z.string()).default([]),
  // البند ١ · حسابٌ منفصلٌ لمستخدمٍ يشارك مكتباً مع غيره
  separateAccount: z.boolean().optional(),
  // 👁️ نوعُ المشاهدة فقط + نطاقُه (مكتبُه وحدَه أو كلُّ مكاتب وكيله)
  viewOnly: z.coerce.boolean().default(false),
  viewAllOffices: z.coerce.boolean().default(false),
  towerId: z.coerce.number().nullable().optional(),
  isActive: z.coerce.boolean().default(true),
});

export async function GET() {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  // عزل المستأجر: المدير يرى مستخدمي وكيله فقط (ولا يرى مالك النظام)
  const users = await prisma.user.findMany({
    where: { isDeleted: false, isOwner: false, agentId: g.session?.agentId ?? -1 },
    orderBy: { id: "asc" },
    select: {
      id: true, fullName: true, username: true, isAdmin: true,
      permissions: true, deniedPermissions: true, separateAccount: true, towerId: true, isActive: true,
      viewOnly: true, viewAllOffices: true,
    },
  });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  if (await usernameTaken(parsed.data.username)) {
    return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
  }

  // عزل المستأجر: المستخدم يُنشأ ضمن وكيل المدير، وأي مكتب مُسنَد يجب أن يتبع وكيله
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });
  const { permissions, deniedPermissions, password, ...rest } = parsed.data;
  // 👁️ المشاهدُ **بلا صلاحيّةٍ وبلا إدارةٍ أبداً** — يُفرَض خادميّاً لا في النموذج:
  // فلو أُرسل `isAdmin` أو قائمةُ صلاحيّاتٍ مع نوع المشاهدة لَأُهملت كلُّها هنا.
  // ونطاقُ «مكتبُه وحدَه» يلزمه مكتبٌ فعليّ، وإلّا بقي بلا نطاقٍ فلا يرى شيئاً.
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
  if (rest.towerId != null) {
    const t = await prisma.tower.findFirst({ where: { id: rest.towerId, agentId, isDeleted: false }, select: { id: true } });
    if (!t) return NextResponse.json({ error: "المكتب المحدّد لا يتبع حسابك" }, { status: 403 });
  }
  // فرض حدود الوكيل: أقصى عدد مدراء (isAdmin) أو مستخدمين عاديين
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { maxManagers: true, maxUsers: true } });
  if (agent) {
    const isManager = rest.isAdmin === true;
    const current = await prisma.user.count({ where: { agentId, isDeleted: false, isOwner: false, isAdmin: isManager } });
    const cap = isManager ? agent.maxManagers : agent.maxUsers;
    if (current >= cap) {
      return NextResponse.json({ error: `بلغت الحد الأقصى ${isManager ? "للمدراء" : "للمستخدمين"} (${cap})` }, { status: 403 });
    }
  }
  const created = await prisma.user.create({
    data: {
      ...rest,
      agentId,
      password: await hashPassword(password),
      permissions: permissions.join(","),
      deniedPermissions: deniedPermissions.join(",") || null,
    },
    select: { id: true, fullName: true, username: true, isAdmin: true, permissions: true, towerId: true, isActive: true, viewOnly: true, viewAllOffices: true },
  });
  return NextResponse.json(created, { status: 201 });
}
