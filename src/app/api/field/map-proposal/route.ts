import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower } from "@/lib/guard";
import { candidateColumnNames, extractNetUser, areaFromTowerName } from "@/lib/mapLocation";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

// ===== الفني يُرسل موقع العمود، والمدير يقبله (طلب محمد 2026-08-05) =====
// مشتركٌ عموده ليس على الخريطة = فنيٌّ يبحث عن بيته بالسؤال. والفني واقفٌ عند العمود
// فعلاً، فهو أصدق مَن يحدّده. يرسل إحداثيه من هاتفه فيصل المدير إشعار، ولا يُكتب في
// الخريطة الدائمة إلا بقبوله.
//
// **اسم العمود يُحسب هنا في الخادم** من يوزر المشترك ومنطقة مكتبه — لا يُقبل من الهاتف
// إطلاقاً، فلا يُسمّى عمودٌ باسم غيره ولا تُمَسّ منطقة وكيلٍ آخر. وما كان له موقع أصلاً
// يُرفض اقتراحه: هذه الميزة لسدّ الثغرات لا لتغيير المثبَّت.

// يستخرج اسم العمود المتوقَّع من بطاقة/مشترك — بنفس منطق زرّ الخريطة حرفاً بحرف
async function resolveTargetName(params: {
  subscriberId?: number | null; netUser?: string | null; text?: string | null; towerId?: number | null;
  agentId: number | null; isTech: boolean; session: { isAdmin?: boolean; towerId?: number | null } | null;
}): Promise<{ ok: true; name: string; netUser: string; towerId: number | null; subscriberId: number | null } | { ok: false; error: string; status: number }> {
  let netUser = params.netUser ?? null;
  let towerId = params.towerId ?? null;
  let subscriberId = params.subscriberId ?? null;

  if (!netUser && subscriberId != null) {
    const s = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { netUser: true, towerId: true } });
    if (s) { netUser = s.netUser ?? null; towerId = towerId ?? s.towerId; }
  }
  if (!netUser && params.text) netUser = extractNetUser(params.text);
  if (!netUser) return { ok: false, error: "لا يوجد يوزر لتحديد العمود", status: 400 };

  // المشترك (للتوثيق والعزل) — ضمن مكاتب الوكيل حصراً
  if (subscriberId == null) {
    const agentTowers = await prisma.tower.findMany({ where: { agentId: params.agentId ?? -1 }, select: { id: true } });
    const s = await prisma.subscriber.findFirst({
      where: {
        netUser: { equals: netUser, mode: "insensitive" }, isDeleted: false,
        towerId: { in: agentTowers.length ? agentTowers.map((t) => t.id) : [-1] },
      },
      select: { id: true, towerId: true },
    });
    if (s) { subscriberId = s.id; towerId = towerId ?? s.towerId; }
  }

  // منطقة الخريطة من مكتب المشترك — والمكتب يجب أن يتبع وكيل المُرسِل (عزل صارم)
  let areaHint: string | null = null;
  if (towerId != null) {
    const t = await prisma.tower.findFirst({ where: { id: towerId, agentId: params.agentId ?? -1 }, select: { name: true, mapArea: true } });
    if (!t) return { ok: false, error: "المكتب لا يتبع حسابك", status: 403 };
    areaHint = (t.mapArea && t.mapArea.trim()) ? t.mapArea.trim() : areaFromTowerName(t.name);
  }
  const names = candidateColumnNames(netUser, areaHint);
  if (!names.length) return { ok: false, error: "يوزر غير قياسي — تعذّر اشتقاق اسم العمود", status: 400 };
  return { ok: true, name: names[0], netUser, towerId, subscriberId };
}

// POST: إرسال موقع العمود (الفني أو مستخدم المكتب)
export async function POST(request: Request) {
  const session = await getSession();
  const tech = session ? null : await getTechSession();
  if (!session && !tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const agentId = tech ? tech.agentId : session?.agentId ?? null;

  const b = await request.json().catch(() => null);
  const lat = Number(b?.lat);
  const lng = Number(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "إحداثي غير صالح" }, { status: 400 });
  }

  const t = await resolveTargetName({
    subscriberId: b?.subscriberId != null ? Number(b.subscriberId) : null,
    netUser: typeof b?.netUser === "string" ? b.netUser : null,
    text: typeof b?.text === "string" ? b.text : null,
    towerId: b?.towerId != null ? Number(b.towerId) : null,
    agentId, isTech: !!tech, session: session ?? null,
  });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });

  // موجودٌ أصلاً؟ لا اقتراح — الميزة لسدّ الثغرات لا لتغيير المثبَّت
  const exists = await prisma.mapPoint.findUnique({ where: { name: t.name } });
  if (exists) return NextResponse.json({ error: `العمود ${t.name} موجود على الخريطة أصلاً` }, { status: 409 });

  // اقتراحٌ معلّق لنفس العمود؟ يُحدَّث بالإحداثي الأحدث بدل تكديس الطلبات
  const pending = await prisma.mapPointProposal.findFirst({ where: { name: t.name, status: "pending" } });
  const byName = tech ? tech.name ?? null : session?.fullName ?? session?.username ?? null;
  const data = {
    agentId, towerId: t.towerId, name: t.name, lat, lng,
    accuracy: Number.isFinite(Number(b?.accuracy)) ? Number(b.accuracy) : null,
    netUser: t.netUser, subscriberId: t.subscriberId,
    technicianId: tech ? tech.technicianId : null,
    byName, status: "pending",
  };
  const row = pending
    ? await prisma.mapPointProposal.update({ where: { id: pending.id }, data })
    : await prisma.mapPointProposal.create({ data });

  await notify({
    agentId, towerId: t.towerId, type: "map-proposal",
    title: "📍 موقع عمود جديد بانتظار قبولك",
    body: `${byName ?? "فني"} أرسل موقع العمود ${t.name} (${t.netUser})`,
    refType: "mapPointProposal", refId: row.id,
    url: "/field-management?open=map-proposals",
  });

  return NextResponse.json({ ok: true, id: row.id, name: t.name, updated: !!pending });
}

// GET: الاقتراحات المعلّقة (وآخر المقبولة/المرفوضة) — للمدير
export async function GET(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const all = new URL(request.url).searchParams.get("all") === "1";
  const rows = await prisma.mapPointProposal.findMany({
    where: { agentId: g.session?.agentId ?? -1, ...(all ? {} : { status: "pending" }) },
    orderBy: { id: "desc" },
    take: all ? 100 : 50,
  });
  const subIds = [...new Set(rows.map((r) => r.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, phone: true } }) : [];
  const subName = new Map(subs.map((s) => [s.id, s.name]));
  const towers = await prisma.tower.findMany({ where: { agentId: g.session?.agentId ?? -1 }, select: { id: true, name: true } });
  const officeName = new Map(towers.map((t) => [t.id, t.name]));
  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      subscriber: r.subscriberId != null ? subName.get(r.subscriberId) ?? null : null,
      office: r.towerId != null ? officeName.get(r.towerId) ?? null : null,
      gmaps: `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`,
    })),
    pending: rows.filter((r) => r.status === "pending").length,
  });
}

// PATCH: قبول الاقتراح (يُكتب في الخريطة الدائمة) أو رفضه
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const id = Number(b?.id);
  const action = String(b?.action ?? "");
  if (!id || !["accept", "reject"].includes(action)) {
    return NextResponse.json({ error: "طلب غير مفهوم" }, { status: 400 });
  }
  const row = await prisma.mapPointProposal.findFirst({ where: { id, agentId: g.session?.agentId ?? -1 } });
  if (!row) return NextResponse.json({ error: "الاقتراح غير موجود ضمن حسابك" }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ error: "حُسم هذا الاقتراح سابقاً" }, { status: 400 });
  if (row.towerId != null && !(await ownsTower(g.session, row.towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const actor = g.session?.fullName ?? g.session?.username ?? null;
  if (action === "reject") {
    await prisma.mapPointProposal.update({
      where: { id }, data: { status: "rejected", note: typeof b?.note === "string" ? b.note.slice(0, 300) : null, decidedById: g.session?.userId ?? null, decidedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // القبول: لا يُكتب فوق نقطة موجودة أبداً — الإضافة فقط
  const exists = await prisma.mapPoint.findUnique({ where: { name: row.name } });
  if (exists) {
    await prisma.mapPointProposal.update({
      where: { id }, data: { status: "rejected", note: "العمود أُضيف من مصدر آخر قبل القبول", decidedById: g.session?.userId ?? null, decidedAt: new Date() },
    });
    return NextResponse.json({ error: `العمود ${row.name} صار موجوداً على الخريطة — أُغلق الاقتراح`, status: "rejected" }, { status: 409 });
  }
  await prisma.mapPoint.create({ data: { name: row.name, lat: row.lat, lng: row.lng } });
  await prisma.mapPointProposal.update({
    where: { id }, data: { status: "accepted", decidedById: g.session?.userId ?? null, decidedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId ?? null, action: "MAP_POINT_ADD", entity: "mapPoint", entityId: row.name,
      details:
        `إضافة عمود ${row.name} إلى الخريطة (${row.lat.toFixed(6)}, ${row.lng.toFixed(6)})` +
        ` — أرسله ${row.byName ?? "فني"}${row.netUser ? ` من عند المشترك ${row.netUser}` : ""}` +
        `${actor ? ` — قبِله ${actor}` : ""}`,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, status: "accepted", name: row.name });
}
