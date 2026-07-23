import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { baghdadDayKey } from "@/lib/attendance";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

const monthOf = (dayKey: string) => dayKey.slice(0, 7); // YYYY-MM

// عدد إجازات اليوم المدفوعة (معتمدة أو معلّقة) لفنيٍّ في شهرٍ معيّن — للحصّة
async function usedPaidThisMonth(technicianId: number, month: string, excludeId?: number) {
  return prisma.leave.count({
    where: {
      technicianId, kind: "day", paid: true,
      status: { in: ["approved", "pending"] },
      dayKey: { startsWith: month },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

// GET: للفني → طلباته + حصّته المتبقية هذا الشهر. للمدير → طلبات فنيّي المكتب (المعلّق أولاً).
export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { paidLeavesPerMonth: true } });
    const month = monthOf(baghdadDayKey(new Date()));
    const quota = Math.max(0, t?.paidLeavesPerMonth ?? 0);
    const used = await usedPaidThisMonth(tech.technicianId, month);
    const leaves = await prisma.leave.findMany({
      where: { technicianId: tech.technicianId },
      orderBy: { id: "desc" }, take: 40,
    });
    return NextResponse.json({ role: "technician", quota, used, remaining: Math.max(0, quota - used), leaves });
  }

  const g = await guard("field.manage");
  if (g.error) return g.error;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const agentTowers = await agentTowerIds(g.session);
  // عزل: لا يُقبل مكتب مطلوب إلا ضمن مكاتب وكيل المستخدم (كان يُمرَّر أي معرّف)
  const towerFilter = reqOffice && agentTowers.includes(reqOffice) ? [reqOffice] : (agentTowers.length ? agentTowers : [-1]);
  // فنيّو المكتب/الوكيل فقط
  const techs = await prisma.technician.findMany({ where: { towerId: { in: towerFilter }, isDeleted: false }, select: { id: true, name: true } });
  const nameById = new Map(techs.map((t) => [t.id, t.name]));
  const leaves = await prisma.leave.findMany({
    where: { technicianId: { in: techs.map((t) => t.id) } },
    orderBy: [{ status: "asc" }, { id: "desc" }], take: 100,
  });
  // "pending" يسبق "approved"/"rejected" أبجدياً؟ لا — نرتّب المعلّق أولاً يدوياً
  const order = (s: string) => (s === "pending" ? 0 : 1);
  leaves.sort((a, b) => order(a.status) - order(b.status) || b.id - a.id);
  const pendingCount = leaves.filter((l) => l.status === "pending").length;
  return NextResponse.json({
    role: "manager", pendingCount,
    leaves: leaves.map((l) => ({ ...l, technicianName: nameById.get(l.technicianId) ?? `#${l.technicianId}` })),
  });
}

// POST (فني فقط): إنشاء طلب إجازة (يوم براتب/بلا أو زمنية) — سبب إلزامي
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = z.object({
    kind: z.enum(["day", "time"]),
    paid: z.boolean().optional(),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح"),
    startMin: z.coerce.number().int().min(0).max(1440).optional(),
    endMin: z.coerce.number().int().min(0).max(1440).optional(),
    reason: z.string().trim().min(1, "السبب مطلوب"),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { kind, dayKey, reason } = parsed.data;
  const month = monthOf(dayKey);

  if (kind === "time") {
    const { startMin, endMin } = parsed.data;
    if (startMin == null || endMin == null || endMin <= startMin) return NextResponse.json({ error: "حدّد فترة زمنية صحيحة (من/إلى)" }, { status: 400 });
    const created = await prisma.leave.create({
      data: { technicianId: tech.technicianId, agentId: tech.agentId, towerId: tech.towerId, kind: "time", paid: false, dayKey, startMin, endMin, reason },
    });
    await notify({ agentId: tech.agentId, towerId: tech.towerId, type: "leave", title: "طلب إجازة زمنية", body: `${tech.name} طلب إجازة زمنية (${dayKey})`, refType: "leave", refId: created.id, url: "/field-management?open=leaves" });
    return NextResponse.json({ ok: true, leave: created });
  }

  // إجازة يوم — منع التكرار لنفس التاريخ (معلّق/معتمد)
  const dup = await prisma.leave.findFirst({ where: { technicianId: tech.technicianId, kind: "day", dayKey, status: { in: ["pending", "approved"] } } });
  if (dup) return NextResponse.json({ error: "لديك إجازة يوم مسجّلة لهذا التاريخ" }, { status: 400 });

  let paid = !!parsed.data.paid;
  if (paid) {
    const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { paidLeavesPerMonth: true } });
    const quota = Math.max(0, t?.paidLeavesPerMonth ?? 0);
    const used = await usedPaidThisMonth(tech.technicianId, month);
    if (used >= quota) return NextResponse.json({ error: "استنفدت حصّة الإجازات المدفوعة لهذا الشهر — اطلبها بلا راتب" }, { status: 400 });
  }
  const created = await prisma.leave.create({
    data: { technicianId: tech.technicianId, agentId: tech.agentId, towerId: tech.towerId, kind: "day", paid, dayKey, reason },
  });
  await notify({ agentId: tech.agentId, towerId: tech.towerId, type: "leave", title: "طلب إجازة", body: `${tech.name} طلب إجازة يوم ${paid ? "براتب" : "بلا راتب"} (${dayKey})`, refType: "leave", refId: created.id, url: "/field-management?open=leaves" });
  return NextResponse.json({ ok: true, leave: created });
}

// PATCH (المدير فقط): قبول/رفض طلب — مع إعادة فحص الحصّة عند اعتماد إجازة مدفوعة
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({ id: z.coerce.number(), status: z.enum(["approved", "rejected"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const leave = await prisma.leave.findUnique({ where: { id: parsed.data.id } });
  if (!leave || !(await ownsTower(g.session, leave.towerId))) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
  if (leave.status !== "pending") return NextResponse.json({ error: "الطلب مُقرّر مسبقاً" }, { status: 400 });

  if (parsed.data.status === "approved" && leave.kind === "day" && leave.paid) {
    const t = await prisma.technician.findUnique({ where: { id: leave.technicianId }, select: { paidLeavesPerMonth: true } });
    const quota = Math.max(0, t?.paidLeavesPerMonth ?? 0);
    const used = await usedPaidThisMonth(leave.technicianId, monthOf(leave.dayKey), leave.id);
    if (used >= quota) return NextResponse.json({ error: "استُنفدت حصّة الإجازات المدفوعة لهذا الشهر — اطلب من الفني إعادتها بلا راتب" }, { status: 400 });
  }

  const updated = await prisma.leave.update({
    where: { id: leave.id },
    data: { status: parsed.data.status, decidedBy: g.session.fullName ?? g.session.username, decidedAt: new Date() },
  });
  return NextResponse.json({ ok: true, leave: updated });
}
