import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, setSession, setTechSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { planState } from "@/lib/agentPlan";
import type { Permission } from "@/lib/rbac";

const schema = z.object({
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(1, "كلمة السر مطلوبة"),
});

// يتحقّق من فعالية الوكيل (غير محذوف/معتمد/غير منتهٍ) — يُشارَك بين دخول المستخدم والفني.
// الاشتراك المنتهي: يُسمح بالدخول خلال **مهلة السماح** (تحذير أحمر بالواجهة)، ويُمنع بعدها.
async function agentBlockReason(agentId: number | null): Promise<string | null> {
  if (agentId == null) return null;
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { planExpiry: true, isDeleted: true, approved: true } });
  if (!agent || agent.isDeleted) return "الحساب غير مفعّل — تواصل مع الإدارة";
  if (!agent.approved) return "حسابك قيد المراجعة — بانتظار موافقة الإدارة على تفعيله";
  const st = planState(agent.planExpiry);
  if (st.status === "blocked") return st.message;
  return null;
}

export async function POST(request: Request) {
  // backstop فضفاض لكل IP ضد الرشّ (60/دقيقة) — لا يمسّ مكتباً مزدحماً خلف إنترنت واحد
  if (!rateLimit(`login-ip:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;
  // حدّ لكل اسم مستخدم (10/دقيقة) — لا يعتمد على IP فلا يُتجاوز بتبديل الترويسة، ولا يُعطّل المكتب
  // المزدحم لأن مستخدميه مختلفون. يعمل مع قفل الحساب في القاعدة (5 محاولات → 15 دقيقة).
  if (!rateLimit(`login-user:${username.trim().toLowerCase()}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة على هذا الحساب — انتظر دقيقة" }, { status: 429 });
  }
  const user = await prisma.user.findUnique({ where: { username } });

  // دخول موحّد: إن لم يكن اسم المستخدم لمستخدمٍ (اليوزر فريد على مستوى النظام) فقد يكون فنّياً.
  if (!user) {
    const tech = await prisma.technician.findFirst({ where: { username: username.trim(), isDeleted: false } });
    if (tech?.code && (await verifyPassword(password, tech.code))) {
      const blocked = await agentBlockReason(tech.agentId);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
      // جهاز واحد فقط: رمز جلسة جديد بكل دخول — يُبطل جلسة أي جهاز سابق فوراً
      const sessionToken = crypto.randomUUID();
      await prisma.technician.update({ where: { id: tech.id }, data: { sessionToken } });
      await setTechSession({ kind: "technician", technicianId: tech.id, name: tech.name, username: tech.username ?? "", agentId: tech.agentId, towerId: tech.towerId, sessionToken });
      // 📜 عقد الاعتماد: دخولُ الفنيّ يمحو كعكةَ الثوب — «لا تغير اي شيء في دخول الفني اطلاقا»
      const techRes = NextResponse.json({ ok: true, redirect: "/field-management" });
      techRes.cookies.set("appSkin", "0", { maxAge: 31536000, path: "/", sameSite: "lax" });
      return techRes;
    }
    return NextResponse.json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" }, { status: 401 });
  }

  if (user.isDeleted || !user.isActive) {
    return NextResponse.json(
      { error: "اسم المستخدم أو كلمة السر غير صحيحة" },
      { status: 401 },
    );
  }

  // قفل مؤقّت بعد محاولات فاشلة كثيرة (منع التخمين)
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `الحساب مقفل مؤقتاً بسبب محاولات كثيرة — حاول بعد ${mins} دقيقة` },
      { status: 429 },
    );
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    // زيادة عدّاد الفشل، وقفل 15 دقيقة بعد 5 محاولات
    const attempts = (user.failedAttempts ?? 0) + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });
    return NextResponse.json(
      { error: "اسم المستخدم أو كلمة السر غير صحيحة" },
      { status: 401 },
    );
  }

  // منع دخول وكيل منتهي الاشتراك (يبقى المالك ومستخدمو النظام بلا وكيل غير متأثّرين)
  if (!user.isOwner) {
    const blocked = await agentBlockReason(user.agentId);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
  }

  // جهاز واحد فقط: رمز جلسة جديد بكل دخول — يُبطل جلسة أي جهاز سابق فوراً (+ تصفير عدّاد الفشل)
  const sessionToken = crypto.randomUUID();
  await prisma.user.update({ where: { id: user.id }, data: { sessionToken, failedAttempts: 0, lockedUntil: null } });

  await setSession({
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    isOwner: user.isOwner,
    agentId: user.agentId ?? null,
    permissions: (user.permissions ?? "").split(",").filter(Boolean) as Permission[],
    // مديرٌ بصلاحيّاتٍ محدَّدة: المنعُ يُحمَل في الجلسة فيسري على كلّ فحصٍ بلا استعلامٍ إضافيّ
    deniedPermissions: (user.deniedPermissions ?? "").split(",").filter(Boolean),
    towerId: user.towerId ?? null,
    sessionToken,
  });

  // سجل تدقيق الدخول
  await prisma.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "user" },
  });

  // توجيه حسب الدور: المالك للوحته، وغيره للوحة التحكم
  // 📜 اعتمادُ طراز التطبيق (عقد محمد 2026-08-19): كعكةُ appSkin تُشعل ثوبَ التطبيق
  //   لجلسات المستخدمين (مدير/موظّف) — **وسريانُها مشروطٌ بوضع التطبيق في العميل**
  //   فلا تغيّر متصفّحَ الحاسبة شيئاً. وليست صلاحيّةً: ستايلٌ محض.
  const res = NextResponse.json({ ok: true, redirect: user.isOwner ? "/owner" : "/dashboard" });
  res.cookies.set("appSkin", "1", { maxAge: 31536000, path: "/", sameSite: "lax" });
  return res;
}
