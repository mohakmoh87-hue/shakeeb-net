import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// مبلغ مكافأة التفعيل لكل باقة (يُضبط من صفحة حسابات المدير) — عزل المستأجر بـ agentId
export async function GET() {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  const packages = await prisma.package.findMany({
    where: { isDeleted: false, agentId: agentId ?? -1 },
    select: { id: true, name: true, priceDinar: true, rewardAmount: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ packages });
}

export async function POST(request: Request) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  const parsed = z.object({ packageId: z.coerce.number(), amount: z.coerce.number().min(0) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  // عزل: لا يُعدَّل إلا باقة تتبع وكيل المستخدم
  const pkg = await prisma.package.findFirst({ where: { id: parsed.data.packageId, agentId: agentId ?? -1 } });
  if (!pkg) return NextResponse.json({ error: "الباقة غير موجودة" }, { status: 404 });

  await prisma.package.update({ where: { id: parsed.data.packageId }, data: { rewardAmount: Math.round(parsed.data.amount) } });
  return NextResponse.json({ ok: true });
}
