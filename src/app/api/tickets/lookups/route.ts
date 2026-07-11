import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// مراجع التذاكر: الأنواع، الأولويات، الحالات
export async function GET() {
  const g = await guard("tickets.manage");
  if (g.error) return g.error;

  const [types, priorities, states] = await Promise.all([
    prisma.ticketType.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" } }),
    prisma.ticketPriority.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" } }),
    prisma.ticketState.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" } }),
  ]);
  return NextResponse.json({ types, priorities, states });
}
