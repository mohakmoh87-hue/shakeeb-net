import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveFieldOffice } from "@/lib/field";
import { agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// دعم مؤقت: استعارة فني من مكتب آخر ليعمل في هذا المكتب (تظهر معلوماته ضمن فنّييه مؤقتاً).
export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const reqOffice = new URL(request.url).searchParams.get("officeId");
  const officeId = resolveFieldOffice(s, reqOffice ? Number(reqOffice) : null);
  if (officeId == null) return NextResponse.json({ borrowed: [], candidates: [] });
  // عزل المستأجر: المكتب والفنيون المرشّحون ضمن وكيل المستخدم فقط
  const agentTowers = await agentTowerIds(s);
  if (!agentTowers.includes(officeId)) return NextResponse.json({ borrowed: [], candidates: [] });

  const towers = await prisma.tower.findMany({ where: { isDeleted: false, id: { in: agentTowers } }, select: { id: true, name: true } });
  const tn = new Map(towers.map((t) => [t.id, t.name]));

  // الفنيون المُعارون حالياً لهذا المكتب
  const borrowed = await prisma.technician.findMany({
    where: { isDeleted: false, supportTowerId: officeId, NOT: { towerId: officeId } },
    orderBy: { id: "asc" },
  });
  // مرشّحون للاستعارة: فنيّو مكاتب الوكيل الأخرى غير المُعارين لهنا أصلاً
  const candidates = await prisma.technician.findMany({
    where: { isDeleted: false, towerId: { in: agentTowers }, NOT: { towerId: officeId }, supportTowerId: null },
    orderBy: { id: "asc" },
  });

  const shape = (t: { id: number; name: string; towerId: number | null }) => ({
    id: t.id, name: t.name, homeOffice: tn.get(t.towerId ?? -1) ?? "—", towerId: t.towerId,
  });
  return NextResponse.json({ officeId, borrowed: borrowed.map(shape), candidates: candidates.map(shape) });
}

// استعارة فني (POST) أو إنهاء الدعم (DELETE)
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const technicianId = Number(b?.technicianId);
  const officeId = resolveFieldOffice(s, b?.officeId != null ? Number(b.officeId) : null);
  if (!technicianId || officeId == null) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });

  const tech = await prisma.technician.findFirst({ where: { id: technicianId, isDeleted: false } });
  if (!tech) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  if (tech.towerId === officeId) return NextResponse.json({ error: "الفني من نفس المكتب" }, { status: 400 });

  await prisma.technician.update({ where: { id: technicianId }, data: { supportTowerId: officeId } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const technicianId = Number(new URL(request.url).searchParams.get("technicianId"));
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  await prisma.technician.updateMany({ where: { id: technicianId }, data: { supportTowerId: null } });
  return NextResponse.json({ ok: true });
}
