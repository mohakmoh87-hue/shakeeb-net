import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny, agentTowerIds } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";

const schema = z.object({
  name: z.string().min(1, "اسم المكتب مطلوب"),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  loginUrl: z.string().nullable().optional(),
  activationTemplate: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
  nesba: z.coerce.number().nullable().optional(),
  groupId: z.coerce.number().nullable().optional(),
  activationMode: z.enum(["month", "days30"]).nullable().optional(), // نظام التفعيل
  managerPhone: z.string().nullable().optional(), // رقم مدير المكتب
  mapArea: z.string().nullable().optional(), // رمز منطقة الخريطة
  rewardsEnabled: z.string().nullable().optional(), // 1 = تفعيل نظام المكافآت للمكتب
  silent: z.string().nullable().optional(), // 1 = إرسال صامت
  waEnabled: z.string().nullable().optional(), // 1 = تفعيل واتساب المكتب
  syncTime: z.string().nullable().optional(), // وقت مزامنة الاشتراكات اليومية (HH:MM)
  syncEnabled: z.string().nullable().optional(), // 1 = تفعيل المزامنة التلقائية
  autoAssignEnabled: z.boolean().optional(), // توزيع البطاقات تلقائياً على فنيي هذا المكتب
  loanEnabled: z.string().nullable().optional(), // 1 = تفعيل قروض سوبر سيل (مدير فقط)
  loanUser: z.string().nullable().optional(), // اسم مستخدم قروض سوبر سيل (مدير فقط)
  loanPass: z.string().nullable().optional(), // كلمة مرور القروض — تُشفَّر (مدير فقط)
});

export async function GET() {
  // القراءة متاحة لإدارة المكاتب أو المشتركين أو المالية أو الاستيراد (لقائمة المكاتب في
  // صفحاتهم — مثل الصندوق وصفحة الاستيراد التي تختار المكتب لفتح SAS)
  const g = await guardAny("offices.edit", "offices.delete", "offices.sync", "subscribers.manage", "subscribers.import", "subscriptions.manage", "finance.view", "finance.manage");
  if (g.error) return g.error;

  // عزل المستأجر: مستخدم المكتب يرى مكتبه؛ مدير الوكيل يرى كل مكاتب وكيله فقط
  const session = g.session;
  let idFilter: { id: number | { in: number[] } };
  if (session && !session.isAdmin && session.towerId != null) {
    idFilter = { id: session.towerId };
  } else {
    const ids = await agentTowerIds(session ?? null);
    idFilter = { id: { in: ids.length ? ids : [-1] } };
  }
  const towers = await prisma.tower.findMany({
    where: { isDeleted: false, ...idFilter },
    orderBy: { id: "asc" },
  });
  // تحصين: لا تُكشف بيانات دخول SAS (اليوزر/الباسورد) إلا لمن يدير المكاتب.
  // بقية المستخدمين يحصلون على الحقول اللازمة للقوائم فقط (بلا كلمات سر) —
  // مع علامة hasSas الآمنة: «مربوط بـSAS» بلا كشف البيانات (تحتاجها صفحة الاستيراد)
  const canManage = can(session, "offices.edit");
  const isAdmin = !!session?.isAdmin; // إعداد القرض للمدير حصراً (طبقة أدقّ من offices.edit)
  const safe = towers.map((t) => {
    const row: Record<string, unknown> = {
      ...t,
      hasSas: !!(t.loginUrl && t.username && t.password),
      hasLoanCreds: !!(t.loanUser && t.loanPass), // «مربوط بقروض سوبر سيل» بلا كشف البيانات
    };
    // بيانات دخول SAS تُكشف لمديري المكاتب فقط
    if (!canManage) { delete row.username; delete row.password; delete row.passOnline; }
    // بيانات القرض للمدير حصراً: يراها مفكوكةً؛ غيره لا يراها (يبقى loanEnabled + hasLoanCreds)
    if (isAdmin) row.loanPass = decryptSecret(t.loanPass);
    else { delete row.loanUser; delete row.loanPass; }
    return row;
  });
  return NextResponse.json(safe);
}

export async function POST(request: Request) {
  const g = await guard("offices.edit");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  // عزل المستأجر + سقف المكاتب: المكتب يُنشأ ضمن وكيل المستخدم، ولا يتجاوز officeCap
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { officeCap: true } });
  const current = await prisma.tower.count({ where: { agentId, isDeleted: false } });
  if (agent && current >= agent.officeCap) {
    return NextResponse.json({ error: `بلغت الحد الأقصى للمكاتب (${agent.officeCap})` }, { status: 403 });
  }

  // إعداد القرض للمدير حصراً: يُشفَّر loanPass، وتُهمَل حقول القرض من غير المدير
  const { loanEnabled, loanUser, loanPass, ...rest } = parsed.data;
  const loanFields = g.session?.isAdmin
    ? { loanEnabled, loanUser, loanPass: encryptSecret(loanPass) }
    : {};
  const created = await prisma.tower.create({ data: { ...rest, ...loanFields, agentId } });
  // كل مدراء الوكيل يحصلون على حساب مصروف/مقبوض في المكتب الجديد تلقائياً —
  // وإلا نسي النظام مكتباً وصار المدير عاجزاً عن الأخذ/الإعطاء فيه
  const { ensureAccountsForNewOffice } = await import("@/lib/managers");
  await ensureAccountsForNewOffice(agentId, created.id).catch(() => {});
  // ومخزنه يُولد بكتالوج الوكيل كاملاً بكمية صفر — فلا يبدأ مكتبٌ جديد بشاشة مخزنٍ فارغة
  const { ensureOfficeCatalog } = await import("@/lib/itemCatalog");
  await ensureOfficeCatalog(agentId, [created.id], { force: true }).catch(() => {});
  return NextResponse.json(created, { status: 201 });
}
