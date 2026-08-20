import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ═════ 📬 الرسائل الداخليّة المنبثقة (طلب محمد — 2026-08-20) ═════
// مدير/مستخدم يُرسل نصّاً حرّاً لفنيٍّ أو مستخدمٍ فيظهر عند المستقبِل منبثقةً لا تُغلق
// إلّا بضغط X، وله الردُّ فيصل المرسِلَ بنفس الآليّة.
// ⛔ الفنيُّ لا يُنشئ رسالةً أبداً — يردّ فقط على رسالةٍ وصلته (شرط محمد الصريح).
// 🔒 العزل: كلُّ استعلامٍ مقيَّدٌ بمعرِّفات الجلسة (userId/technicianId/agentId) في SQL —
//    لا ترشيحَ بنصٍّ يملكه المستخدم (درسُ تسريب سجلّ الرسائل 2026-08-09).
// ⚠️ الجدولُ يُنشأ بسكربت scripts/add-internal-messages.mjs **قبل** أن يعمل هذا المسار —
//    وحتى إنشائه يُعاد فراغٌ هادئ (P2021) بدل انفجار كلّ استطلاع.

const MAX_TEXT = 2000;

// جدولٌ لم يُنشأ بعد في القاعدة ⇒ ميزةٌ خامدة لا عطل
function tableMissing(e: unknown): boolean {
  return typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";
}

// GET: الرسائل المفتوحة للمستقبِل الحالي (فنيّاً كان أو مستخدماً/مديراً).
//   ?compose=1 (للمستخدم/المدير): معه قوائمُ المستقبلين المسموحين (فنّيّو مكاتبه + مستخدمو وكيله).
//   ?sent=1   (للمستخدم/المدير): آخرُ ما أرسله هو، لصفحة «رسالة داخلية».
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const tech = await getTechSession();
    if (tech) {
      const messages = await prisma.internalMessage.findMany({
        where: { toTechId: tech.technicianId, closedAt: null },
        orderBy: { id: "asc" }, take: 20,
        select: { id: true, fromName: true, text: true, createdAt: true, replyToId: true },
      });
      return NextResponse.json({ role: "technician", messages });
    }

    const session = await getSession();
    if (!session) return NextResponse.json({ error: "غير مسجّل دخول" }, { status: 401 });

    const messages = await prisma.internalMessage.findMany({
      where: { toUserId: session.userId, closedAt: null },
      orderBy: { id: "asc" }, take: 20,
      select: { id: true, fromName: true, text: true, createdAt: true, replyToId: true, fromTechId: true, fromUserId: true },
    });

    const out: Record<string, unknown> = { role: "user", messages };

    if (url.searchParams.get("compose") === "1") {
      const towers = await agentTowerIds(session);
      const [techs, users] = await Promise.all([
        prisma.technician.findMany({
          where: { towerId: { in: towers.length ? towers : [-1] }, isDeleted: false },
          select: { id: true, name: true }, orderBy: { name: "asc" },
        }),
        // مستخدمو الوكيل نفسِه (مدراءً ومستخدمين) عدا المرسِل — والوكيلُ الفارغ لا قائمةَ له
        session.agentId != null
          ? prisma.user.findMany({
              where: { agentId: session.agentId, isDeleted: false, id: { not: session.userId } },
              select: { id: true, username: true, fullName: true, isAdmin: true }, orderBy: { username: "asc" },
            })
          : Promise.resolve([]),
      ]);
      out.techs = techs;
      out.users = users.map((u) => ({ id: u.id, name: u.fullName ?? u.username, isAdmin: u.isAdmin }));
    }

    if (url.searchParams.get("sent") === "1") {
      const sent = await prisma.internalMessage.findMany({
        where: { fromUserId: session.userId },
        orderBy: { id: "desc" }, take: 30,
        select: { id: true, text: true, createdAt: true, closedAt: true, toUserId: true, toTechId: true, replyToId: true },
      });
      // أسماء المستقبلين للعرض (ضمن نطاق الوكيل حكماً — فالإرسال أصلاً مقيَّد به)
      const techIds = [...new Set(sent.map((s) => s.toTechId).filter((v): v is number => v != null))];
      const userIds = [...new Set(sent.map((s) => s.toUserId).filter((v): v is number => v != null))];
      const [techs, users] = await Promise.all([
        techIds.length ? prisma.technician.findMany({ where: { id: { in: techIds } }, select: { id: true, name: true } }) : [],
        userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, fullName: true } }) : [],
      ]);
      const tn = new Map(techs.map((t) => [t.id, t.name]));
      const un = new Map(users.map((u) => [u.id, u.fullName ?? u.username]));
      out.sent = sent.map((s) => ({
        ...s,
        toName: s.toTechId != null ? `👷 ${tn.get(s.toTechId) ?? `#${s.toTechId}`}` : `👤 ${un.get(s.toUserId ?? -1) ?? `#${s.toUserId}`}`,
      }));
    }

    return NextResponse.json(out);
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ role: "user", messages: [] });
    throw e;
  }
}

// POST: إنشاء رسالة.
//   مستخدم/مدير: { text, toTechId? | toUserId? } أو ردّ { text, replyToId }.
//   فنيّ: { text, replyToId } فقط — على رسالةٍ وُجّهت إليه هو.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const tech = await getTechSession();
    if (tech) {
      const parsed = z.object({
        replyToId: z.coerce.number().int().positive("الردُّ يحتاج رسالةً أصليّة"),
        text: z.string().trim().min(1, "اكتب نصّ الردّ").max(MAX_TEXT),
      }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });

      // عزل: لا يُردّ إلّا على رسالةٍ مستقبِلُها هذا الفنيُّ نفسُه
      const orig = await prisma.internalMessage.findUnique({ where: { id: parsed.data.replyToId } });
      if (!orig || orig.toTechId !== tech.technicianId) return NextResponse.json({ error: "الرسالة الأصلية غير موجودة" }, { status: 404 });
      if (orig.fromUserId == null) return NextResponse.json({ error: "لا مرسِلَ للردّ عليه" }, { status: 400 });

      const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { name: true } });
      const msg = await prisma.internalMessage.create({
        data: {
          agentId: orig.agentId, fromTechId: tech.technicianId, fromName: `👷 ${t?.name ?? "فني"}`,
          toUserId: orig.fromUserId, text: parsed.data.text, replyToId: orig.id,
        },
      });
      return NextResponse.json({ ok: true, id: msg.id });
    }

    const session = await getSession();
    if (!session) return NextResponse.json({ error: "غير مسجّل دخول" }, { status: 401 });
    const parsed = z.object({
      text: z.string().trim().min(1, "اكتب نصّ الرسالة").max(MAX_TEXT),
      toTechId: z.coerce.number().int().positive().optional(),
      toUserId: z.coerce.number().int().positive().optional(),
      replyToId: z.coerce.number().int().positive().optional(),
    }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
    const d = parsed.data;
    const fromName = `${session.isAdmin ? "🧑‍💼" : "👤"} ${session.fullName ?? session.username}`;

    // ردُّ مستخدمٍ على رسالةٍ وصلته: الوجهةُ مرسِلُ الأصل (فنيّاً كان أو مستخدماً)
    if (d.replyToId != null) {
      const orig = await prisma.internalMessage.findUnique({ where: { id: d.replyToId } });
      if (!orig || orig.toUserId !== session.userId) return NextResponse.json({ error: "الرسالة الأصلية غير موجودة" }, { status: 404 });
      const msg = await prisma.internalMessage.create({
        data: {
          agentId: orig.agentId, fromUserId: session.userId, fromName,
          toTechId: orig.fromTechId, toUserId: orig.fromUserId, text: d.text, replyToId: orig.id,
        },
      });
      if (orig.fromTechId != null) {
        const { sendPushToTechnician } = await import("@/lib/push");
        void sendPushToTechnician(orig.fromTechId, { title: "📩 ردٌّ من الإدارة", body: d.text.slice(0, 120) });
      }
      return NextResponse.json({ ok: true, id: msg.id });
    }

    // رسالة جديدة: وجهةٌ واحدة بالضبط
    if ((d.toTechId == null) === (d.toUserId == null)) {
      return NextResponse.json({ error: "اختر مستقبِلاً واحداً: فنيّاً أو مستخدماً" }, { status: 400 });
    }
    const senderAgentId = session.agentId;
    if (senderAgentId == null) return NextResponse.json({ error: "الحساب بلا وكيل" }, { status: 400 });

    if (d.toTechId != null) {
      // عزل: الفنيُّ من مكاتب وكيل المرسِل حصراً
      const towers = await agentTowerIds(session);
      const t = await prisma.technician.findUnique({ where: { id: d.toTechId }, select: { id: true, towerId: true, isDeleted: true } });
      if (!t || t.isDeleted || t.towerId == null || !towers.includes(t.towerId)) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
      const msg = await prisma.internalMessage.create({
        data: { agentId: senderAgentId, fromUserId: session.userId, fromName, toTechId: t.id, text: d.text },
      });
      // إشعارُ هاتفٍ مرافقٌ مرّةً واحدةً عند الإنشاء (قناة أ-٢٢) — والمنبثقةُ تتكفّل بالبقيّة
      const { sendPushToTechnician } = await import("@/lib/push");
      void sendPushToTechnician(t.id, { title: "📩 رسالة من الإدارة", body: d.text.slice(0, 120) });
      return NextResponse.json({ ok: true, id: msg.id });
    }

    // عزل: المستخدمُ من وكيل المرسِل نفسِه حصراً
    const u = await prisma.user.findUnique({ where: { id: d.toUserId! }, select: { id: true, agentId: true, isDeleted: true } });
    if (!u || u.isDeleted || u.agentId !== senderAgentId || u.id === session.userId) {
      return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    }
    const msg = await prisma.internalMessage.create({
      data: { agentId: senderAgentId, fromUserId: session.userId, fromName, toUserId: u.id, text: d.text },
    });
    return NextResponse.json({ ok: true, id: msg.id });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ error: "الميزة لم تُهيّأ بعد (جدول القاعدة غير موجود)" }, { status: 503 });
    throw e;
  }
}

// PATCH: إغلاق رسالة (زرّ X) — المستقبِلُ وحدَه يغلق رسالتَه، والإغلاقُ مكرَّراً لا يضرّ
export async function PATCH(request: Request) {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  try {
    const tech = await getTechSession();
    if (tech) {
      const r = await prisma.internalMessage.updateMany({
        where: { id: parsed.data.id, toTechId: tech.technicianId, closedAt: null },
        data: { closedAt: new Date() },
      });
      return NextResponse.json({ ok: true, closed: r.count });
    }
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "غير مسجّل دخول" }, { status: 401 });
    const r = await prisma.internalMessage.updateMany({
      where: { id: parsed.data.id, toUserId: session.userId, closedAt: null },
      data: { closedAt: new Date() },
    });
    return NextResponse.json({ ok: true, closed: r.count });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ ok: true, closed: 0 });
    throw e;
  }
}
