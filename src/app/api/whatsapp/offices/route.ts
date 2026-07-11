import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { whatsappStatus } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// قائمة المكاتب التي لها واتساب (لواجهة الردود في حسابات المدير)
export async function GET() {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;

  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, OR: [{ NOT: { waEnabled: "0" } }, { managerPhone: { not: null } }] },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({
    offices: offices.map((o) => ({ id: o.id, name: o.name, state: whatsappStatus(o.id).state })),
  });
}
