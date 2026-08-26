import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { computeDailyReport, reportUserScope } from "@/lib/dailyReport";

export const dynamic = "force-dynamic";

// التقرير اليومي لمكتب محدّد أو الإجمالي (لتبويبات تقرير المدير في الشاشة الرئيسية).
// المدير: يختار أي مكتب أو الإجمالي (towerId=all)، ولمكتبٍ فيه مستخدمان+ يختار المستخدم (userId).
// مستخدم المكتب: مكتبه فقط دائماً — وإن كان بمكتبه مستخدمان+ يُجبَر على تقريره هو وحده.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const param = sp.get("towerId");
  const agentTowers = await agentTowerIds(session);
  let scope: number | number[] | null;
  let userId: number | undefined;
  if (session.isAdmin) {
    // الإجمالي = كل مكاتب الوكيل؛ مكتب محدّد = فقط إن كان ضمن وكيله
    if (!param || param === "all") scope = agentTowers;
    else { const t = Number(param) || -1; scope = agentTowers.includes(t) ? t : -1; }
    // اختيار مستخدمٍ محدّد (لمكتبٍ فيه مستخدمان+) — يُقبل فقط إن كان المستخدم من وكيله
    const uParam = Number(sp.get("userId")) || 0;
    if (uParam > 0) {
      const u = await prisma.user.findFirst({ where: { id: uParam, agentId: session.agentId ?? -1, isDeleted: false }, select: { id: true } });
      if (u) userId = u.id;
    }
  } else {
    // مستخدم المكتب مقيّد بمكتبه؛ ومَن بلا مكتب يُقيَّد **بمكاتب وكيله** لا بـnull —
    // لأن null كان يعني «بلا فلتر» فيرى مال كل المكاتب في القاعدة بما فيها وكلاء آخرون
    // (خرق عزل + مبالغ ضخمة بلا مصدر). وبلا مكاتب لوكيله: لا شيء.
    scope = session.towerId ?? (agentTowers.length ? agentTowers : [-1]);
    // مكتبٌ فيه مستخدمان+ ⇒ تقريره هو وحده (إجباريّ — لا يُقبل userId من العميل)
    userId = await reportUserScope(session);
  }

  // ===== أ-٦ · تقريرُ **يومٍ سابق** (طلب محمد 2026-08-11) =====
  // شكواه: «أُشاهد مبلغ يومٍ سابقٍ ولا أعرف من أين جاء». و`computeDailyReport` تقبل تاريخاً
  // أصلاً، لكنّ هذا المسار كان يُمرّر `undefined` دائماً ⇒ اليومُ وحده. الآن يقبل `day`.
  // 🔒 والعزلُ لا يُمَسّ: النطاقُ محسوبٌ أعلاه من `agentTowerIds`/مكتبِ الجلسة، و`userId` لا
  //    يُقبل من العميل لغير المدير — فإضافةُ التاريخ لا تفتح بياناتِ أحد.
  const parseDay = (v: string | null): Date | undefined => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    // منتصفُ نهارِ بغداد لذلك اليوم — تُشتقّ منه `iraqTodayRange` حدودَ اليوم بلا لبسٍ عند الحدود
    const d = new Date(`${v}T12:00:00+03:00`);
    return isNaN(d.getTime()) ? undefined : d;
  };
  const dayParam = sp.get("day");
  const day = parseDay(dayParam);
  // ═════ ج · «بين تاريخين» (طلبُ محمد 2026-08-26): from/to يغلبان day ═════
  // 🔒 والعزلُ لم يتغيّر حرفاً: النطاقُ والمستخدمُ محسوبان أعلاه بنفس الحرّاس —
  //    فاتّساعُ الزمن لا يفتح مكتبَ أحدٍ ولا مستخدمَه.
  const fromD = parseDay(sp.get("from"));
  const toD = parseDay(sp.get("to"));
  const ranged = fromD != null && toD != null;

  // ═════ أ · مستخدمو المكتب المنفصلون — للتبويبات في نافذة اليوم السابق ═════
  // تُعاد القائمةُ للمدير حين يطلب مكتباً محدّداً، **وبشرط الفصل** (قاعدة محمد
  // 2026-08-26): مستخدمان+ حسابُهما منفصلٌ وإلّا `[]` فلا تُبنى تبويباتٌ أصلاً —
  // مكتبُ المستخدم الواحد وغيرُ المفصولين يبقيان «المكتبَ فقط» بلا أيّ تغيير.
  let officeUsers: { id: number; name: string }[] = [];
  if (session.isAdmin && typeof scope === "number" && scope > 0) {
    const us = await prisma.user.findMany({
      where: { towerId: scope, agentId: session.agentId ?? -1, isDeleted: false, isActive: true, isOwner: false, separateAccount: true },
      select: { id: true, fullName: true, username: true }, orderBy: { id: "asc" },
    });
    if (us.length >= 2) officeUsers = us.map((u) => ({ id: u.id, name: u.fullName || u.username }));
  }

  const r = await computeDailyReport(scope, ranged ? fromD : day, userId, ranged ? toD : undefined);
  return NextResponse.json({
    ...r,
    day: dayParam && day ? dayParam : null,
    range: ranged ? { from: sp.get("from"), to: sp.get("to") } : null,
    officeUsers,
  });
}
