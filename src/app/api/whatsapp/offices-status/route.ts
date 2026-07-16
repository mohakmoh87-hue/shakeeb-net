import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOfficeFilter } from "@/lib/guard";
import { readOfficeStates } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// حالة واتساب للتنبيه: كل مستخدم يُنبَّه على مكتبه فقط، والأدمن على كل المكاتب
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  // عزل المستأجر: مستخدم المكتب ⇒ مكتبه؛ مدير الوكيل ⇒ كل مكاتب وكيله
  const officeFilter = await agentOfficeFilter(session);

  // المكاتب التي تحتاج واتساب (لمشتركيها أو لمديرها) — مستقل عن مفتاح رسائل المشتركين
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, OR: [{ NOT: { waEnabled: "0" } }, { managerPhone: { not: null } }], ...officeFilter },
    select: { id: true, name: true },
  });
  const states = await readOfficeStates(offices.map((o) => o.id));
  const list = offices.map((o) => ({ id: o.id, name: o.name, state: states[o.id] ?? "disconnected" }));
  return NextResponse.json({ offices: list, disconnected: list.filter((o) => o.state !== "ready") });
}
