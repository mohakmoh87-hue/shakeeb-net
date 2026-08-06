import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1, "اسم المشترك مطلوب"),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  packageId: z.coerce.number().nullable().optional(),
  towerId: z.coerce.number().nullable().optional(),
  note: z.string().nullable().optional(),
  carry: z.coerce.number().nullable().optional(),
  wifiUser: z.string().nullable().optional(),
  wifiPass: z.string().nullable().optional(),
  netUser: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  affiliate: z.string().nullable().optional(),
  telegram: z.string().nullable().optional(),
  ftth: z.string().nullable().optional(),
  employee: z.string().nullable().optional(),
  subPassword: z.string().nullable().optional(),
  userNano: z.string().nullable().optional(),
  passNano: z.string().nullable().optional(),
  ipNano: z.string().nullable().optional(),
  waEnabled: z.boolean().optional(), // إرسال واتساب لهذا المشترك (افتراضي مفعّل)
});

// وسم hasLoan لكلّ مشترك: هل عليه دين قرضٍ قائم **ومكتبه مفعَّل للقرض**؟ (للوسم والتنبيه والزرّ).
// إطفاء المكتب يُخفي كلّ الآثار: hasLoan يعود false فيختفي الوسم والتنبيه — مع بقاء الدين محفوظاً.
// عزل: يُستعلَم بمعرّفات المشتركين المسحوبين أصلاً (المعزولين بالمكتب/الوكيل)، فلا تسرّب.
async function attachLoanFlag<T extends { id: number; towerId: number | null }>(items: T[]): Promise<(T & { hasLoan: boolean })[]> {
  if (!items.length) return [];
  const ids = items.map((i) => i.id);
  const loans = await prisma.loanDebt.findMany({
    where: { subscriberId: { in: ids }, isDeleted: false },
    select: { subscriberId: true },
  });
  const loanSet = new Set(loans.map((l) => l.subscriberId));
  if (!loanSet.size) return items.map((i) => ({ ...i, hasLoan: false }));
  // المكاتب المفعّلة للقرض فقط تُظهر الوسم/التنبيه (إطفاء المكتب = إخفاء تامّ بلا محو الدين)
  const towerIds = [...new Set(items.map((i) => i.towerId).filter((x): x is number => x != null))];
  const onTowers = towerIds.length
    ? await prisma.tower.findMany({ where: { id: { in: towerIds }, loanEnabled: "1" }, select: { id: true } })
    : [];
  const onSet = new Set(onTowers.map((t) => t.id));
  return items.map((i) => ({ ...i, hasLoan: loanSet.has(i.id) && i.towerId != null && onSet.has(i.towerId) }));
}

export async function GET(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const showAll = url.searchParams.get("all") === "1"; // «عرض جميع المشتركين من كل المكاتب»
  // عزل المستأجر: مستخدم المكتب ⇒ مكتبه؛ مدير الوكيل ⇒ كل مكاتب وكيله فقط
  const agentTowers = await agentTowerIds(g.session ?? null);
  const isOfficeUser = !g.session?.isAdmin && g.session?.towerId != null;
  // عند تفعيل «عرض الكل» يرى مستخدم المكتب أيضاً كل مكاتب وكيله (يبقى ضمن عزل الوكيل)
  const towerFilter = isOfficeUser && !showAll
    ? { towerId: g.session!.towerId! }
    : { towerId: { in: agentTowers.length ? agentTowers : [-1] } };

  // مطابقة اسم المكتب: نجلب معرّفات المكاتب (ضمن وكيل المستخدم) التي يتضمّن اسمها نص البحث
  let matchedTowerIds: number[] = [];
  if (q) {
    const towers = await prisma.tower.findMany({
      where: { isDeleted: false, id: { in: agentTowers.length ? agentTowers : [-1] }, name: { contains: q, mode: "insensitive" } },
      select: { id: true },
    });
    matchedTowerIds = towers.map((t) => t.id);
  }

  const where = {
    isDeleted: false,
    ...towerFilter,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { netUser: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { address: { contains: q, mode: "insensitive" as const } },
            // البحث باسم المكتب
            ...(matchedTowerIds.length ? [{ towerId: { in: matchedTowerIds } }] : []),
          ],
        }
      : {}),
  };

  // وضع «آخر التفعيلات» (الشاشة الرئيسية بالطراز الجديد): آخر 50 مشتركاً مرتّبين
  // بآخر تفعيل من الأحدث للأقدم — بلا بحث؛ البحث يعود للمسار الأبجدي أدناه
  if (url.searchParams.get("recent") === "1" && !q) {
    const groups = await prisma.subscriptionEntry.groupBy({
      by: ["subscriberId"],
      where: { isDeleted: false, subscriberId: { not: null }, ...towerFilter },
      _max: { date: true },
      orderBy: { _max: { date: "desc" } },
      take: 50, // 50 فقط لتخفيف الحمل عند فتح الصفحة (قرار محمد) — البحث يغطي الباقي
    });
    const ids = groups.map((x) => x.subscriberId).filter((x): x is number => x != null);
    const [items, total] = await Promise.all([
      prisma.subscriber.findMany({
        where: { id: { in: ids }, isDeleted: false },
        select: {
          id: true, name: true, phone: true, address: true, packageId: true,
          towerId: true, carry: true, dateTo: true, netUser: true, sasId: true,
          note: true, smsEnabled: true, waEnabled: true, transferredTo: true,
          rewardBalance: true, rewardCode: true,
        },
      }),
      prisma.subscriber.count({ where: { isDeleted: false, ...towerFilter } }),
    ]);
    const rank = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
    return NextResponse.json(await attachLoanFlag(items), { headers: { "X-Total-Count": String(total), "X-Limit": "50" } });
  }

  // حدّ التحميل: نجلب أول 300 فقط (القائمة كبيرة — 5000+)، والبحث يغطّي الباقي.
  // هذا يقلّل النقل من فرانكفورت ورسم آلاف الصفوف، فتُفتح الصفحة فوراً.
  const LIMIT = 300;
  const [items, total] = await Promise.all([
    prisma.subscriber.findMany({
      where,
      // نُرجع الأعمدة التي تعرضها الواجهة فقط (بدل 30+ عموداً) — أخفّ نقلاً ومعالجةً
      select: {
        id: true, name: true, phone: true, address: true, packageId: true,
        towerId: true, carry: true, dateTo: true, netUser: true, sasId: true,
        note: true, smsEnabled: true, waEnabled: true, transferredTo: true,
        rewardBalance: true, rewardCode: true,
      },
      orderBy: { name: "asc" },
      take: LIMIT,
    }),
    prisma.subscriber.count({ where }),
  ]);
  // نُبقي الرد مصفوفةً (توافقاً مع بقية الصفحات)، والمجموع/الحدّ في ترويسات
  return NextResponse.json(await attachLoanFlag(items), {
    headers: { "X-Total-Count": String(total), "X-Limit": String(LIMIT) },
  });
}

export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  // مستخدم المكتب: يُفرض مكتبه دائماً (لا يستطيع إنشاء مشترك لمكتب آخر أو بدون مكتب)
  const towerId =
    session && !session.isAdmin && session.towerId != null
      ? session.towerId
      : parsed.data.towerId ?? null;

  // عزل المستأجر: لا يُنشأ مشترك إلا في مكتب يتبع وكيل المستخدم
  const agentTowers = await agentTowerIds(session);
  if (towerId == null || !agentTowers.includes(towerId)) {
    return NextResponse.json({ error: "المكتب المحدّد لا يتبع حسابك" }, { status: 403 });
  }

  // فرض حدّ الوكيل: أقصى عدد مشتركين ضمن مكاتبه (الإضافة اليدوية؛ استيراد المزامنة لا يُحجب)
  const agentId = session?.agentId ?? null;
  if (agentId != null) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { maxSubscribers: true } });
    if (agent) {
      const current = await prisma.subscriber.count({ where: { isDeleted: false, towerId: { in: agentTowers.length ? agentTowers : [-1] } } });
      if (current >= agent.maxSubscribers) {
        return NextResponse.json({ error: `بلغت الحد الأقصى للمشتركين (${agent.maxSubscribers})` }, { status: 403 });
      }
    }
  }

  const created = await prisma.subscriber.create({
    data: {
      ...parsed.data,
      towerId,
      createdByUser: session?.username,
      createdByName: session?.fullName,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
