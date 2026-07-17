import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasFetchOnePage, type SasUser } from "@/lib/sas4";
import { relayRequest } from "@/lib/whatsapp";

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

  const tower = await prisma.tower.findUnique({ where: { id: towerId } });
  if (!tower || !tower.loginUrl || !tower.username || !tower.password) {
    return NextResponse.json(
      { error: "المكتب لا يحتوي رابط SAS4 واسم مستخدم وكلمة سر" },
      { status: 400 },
    );
  }

  try {
    // جلب الصفحة عبر حاسبة المكتب (SAS قريب فأسرع) إن كانت مشغّلة، وإلا مباشرةً من الموقع
    const relayed = await relayRequest(towerId, "sas", { op: "fetchPage", page, count }, 20_000);
    let users: SasUser[], total: number, lastPage: number;
    if (relayed.ok && relayed.result) {
      ({ users, total, lastPage } = relayed.result as { users: SasUser[]; total: number; lastPage: number });
    } else {
      const base = sasBaseUrl(tower.loginUrl);
      const token = await sasLogin(base, tower.username, tower.password);
      ({ users, total, lastPage } = await sasFetchOnePage(base, token, page, count));
    }

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
