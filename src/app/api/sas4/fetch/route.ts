import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasFetchOnePage } from "@/lib/sas4";

const schema = z.object({
  towerId: z.coerce.number(),
  page: z.coerce.number().min(1).default(1),
  count: z.coerce.number().min(1).max(500).default(50), // حجم الصفحة (كما في SAS4)
});

// تسجيل الدخول تلقائياً بحساب المكتب وجلب صفحة واحدة بالحجم المطلوب
export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }
  const { towerId, page, count } = parsed.data;

  // عزل المستأجر: لا يُجلب من SAS إلا لمكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const tower = await prisma.tower.findUnique({ where: { id: towerId } });
  if (!tower || !tower.loginUrl || !tower.username || !tower.password) {
    return NextResponse.json(
      { error: "المكتب لا يحتوي رابط SAS4 واسم مستخدم وكلمة سر" },
      { status: 400 },
    );
  }

  try {
    const base = sasBaseUrl(tower.loginUrl);
    const token = await sasLogin(base, tower.username, tower.password);
    const { users, total, lastPage } = await sasFetchOnePage(base, token, page, count);

    const existing = await prisma.subscriber.findMany({
      where: { sasId: { in: users.map((u) => u.sasId) } },
      select: { sasId: true },
    });
    const existingIds = new Set(existing.map((e) => e.sasId));

    return NextResponse.json({
      total,
      lastPage,
      page,
      count,
      users: users.map((u) => ({ ...u, alreadyImported: existingIds.has(u.sasId) })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "فشل الاتصال بـ SAS4" },
      { status: 502 },
    );
  }
}
