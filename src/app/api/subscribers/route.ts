import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
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

export async function GET(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  // عرض كل المكاتب متاح للمدير فقط؛ مستخدم المكتب مقيّد بمكتبه دائماً
  const showAll = url.searchParams.get("all") === "1" && !!g.session?.isAdmin;
  // فلترة حسب مكتب المستخدم (المكتب) ما لم يُطلب عرض كل المكاتب
  const towerFilter =
    !showAll && g.session?.towerId ? { towerId: g.session.towerId } : {};

  // مطابقة اسم المكتب: نجلب معرّفات المكاتب التي يتضمّن اسمها نص البحث
  let matchedTowerIds: number[] = [];
  if (q) {
    const towers = await prisma.tower.findMany({
      where: { isDeleted: false, name: { contains: q, mode: "insensitive" } },
      select: { id: true },
    });
    matchedTowerIds = towers.map((t) => t.id);
  }

  const subscribers = await prisma.subscriber.findMany({
    where: {
      isDeleted: false,
      ...towerFilter,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { netUser: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { address: { contains: q, mode: "insensitive" } },
              // البحث باسم المكتب
              ...(matchedTowerIds.length ? [{ towerId: { in: matchedTowerIds } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(subscribers);
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
