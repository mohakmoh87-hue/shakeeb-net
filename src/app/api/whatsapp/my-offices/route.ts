import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOfficeFilter } from "@/lib/guard";
import { readOfficeStates } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// مكاتب المستخدم لربط الواتساب (دائماً، بلا فلتر) — الأدمن كل المكاتب، غيره مكتبه فقط
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const where = { isDeleted: false, ...(await agentOfficeFilter(session)) };
  const offices = await prisma.tower.findMany({ where, select: { id: true, name: true }, orderBy: { id: "asc" } });
  const states = await readOfficeStates(offices.map((o) => o.id));
  return NextResponse.json({ offices: offices.map((o) => ({ id: o.id, name: o.name, state: states[o.id] ?? "disconnected" })) });
}
