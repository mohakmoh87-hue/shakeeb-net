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
      isDeleted: false, // أ-٨ · إجازةٌ أُزيلت لا تستهلك الحصّة
      status: { in: ["approved", "pending"] },
      dayKey: { startsWith: month },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/** أيّامُ مدىٍ شامل (YYYY-MM-DD) — أو `null` إن كان المدى مقلوباً أو أطولَ من الحدّ.
 *  والحدُّ ٦٢ يوماً: إجازةٌ أطولُ من شهرَين ليست إجازةً بل انفصالٌ، وهو حرزٌ من
 *  خطأِ كتابةٍ في السنة يُنشئ آلافَ الصفوف بضغطةٍ واحدة. */
function daysBetween(from: string, to: string, max = 62): string[] | null {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return null;
  const out: string[] = [];
  for (const d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > max) return null;
  }
  return out;
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
      where: { technicianId: tech.technicianId, isDeleted: false }, // أ-٨ · المُزالةُ لا تُعرَض
      orderBy: { id: "desc" }, take: 40,
    });
    return NextResponse.json({ role: "technician", quota, used, remaining: Math.max(0, quota - used), leaves });
  }

  const g = await guard("field.payroll");
  if (g.error) return g.error;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const agentTowers = await agentTowerIds(g.session);
  // عزل: لا يُقبل مكتب مطلوب إلا ضمن مكاتب وكيل المستخدم (كان يُمرَّر أي معرّف)
  const towerFilter = reqOffice && agentTowers.includes(reqOffice) ? [reqOffice] : (agentTowers.length ? agentTowers : [-1]);
  // فنيّو المكتب/الوكيل فقط
  const techs = await prisma.technician.findMany({ where: { towerId: { in: towerFilter }, isDeleted: false }, select: { id: true, name: true } });
  const nameById = new Map(techs.map((t) => [t.id, t.name]));
  const leaves = await prisma.leave.findMany({
    where: { technicianId: { in: techs.map((t) => t.id) }, isDeleted: false }, // أ-٨
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

// ═════ أ-٨ · المديرُ يمنح إجازةً لفنيٍّ ولمدّةٍ (طلبُ محمد) ═════
// 🔴 كان `POST` يلزم **جلسةَ فنيّ** فيردّ ٤٠١ للمدير ⇒ لا سبيلَ لمنحِ إجازةٍ إلّا أن
//   يفتح الفنيُّ تطبيقَه ويطلبها ثمّ يعتمدها المدير. وهو طلبٌ يوميٌّ ممنوعٌ تقنيّاً.
// 🔑 وما يمنحه المديرُ **معتمَدٌ من لحظته**: هو صاحبُ الاعتماد أصلاً، فطلبٌ ينتظر
//   موافقتَه على نفسِه عبثٌ. ويُكتَب `decidedBy` باسمه فيُعرَف مانحُها.
// 🔑 و**مدىً لا يوماً**: كان الصفُّ ليومٍ واحدٍ فإجازةُ ثلاثةِ أيّامٍ ثلاثُ عمليّات.
//   والمدى يُنشئ صفّاً ليوم — فيبقى الاحتسابُ والإزالةُ لكلّ يومٍ على حدة.
// 🔒 والعزلُ صارم: `ownsTower` على مكتبِ الفنيّ — لا إجازةَ لفنيٍّ من مكتبٍ لا يملكه.
async function managerCreate(request: Request, body: unknown) {
  const g = await guard("field.payroll");
  if (g.error) return g.error;
  const parsed = z.object({
    technicianId: z.coerce.number().int().positive(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ البداية غير صحيح"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ النهاية غير صحيح").optional(),
    paid: z.boolean().optional(),
    reason: z.string().trim().min(1, "السبب مطلوب"),
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { technicianId, from, reason } = parsed.data;
  const to = parsed.data.to || from;
  const paid = !!parsed.data.paid;

  const tech = await prisma.technician.findFirst({
    where: { id: technicianId, isDeleted: false },
    select: { id: true, name: true, towerId: true, agentId: true, paidLeavesPerMonth: true },
  });
  if (!tech || !(await ownsTower(g.session, tech.towerId))) {
    return NextResponse.json({ error: "الفنيّ غير موجود أو لا يتبع مكاتبك" }, { status: 404 });
  }

  const days = daysBetween(from, to);
  if (!days) return NextResponse.json({ error: "مدىٌ غير صحيح (النهاية قبل البداية، أو أطولُ من ٦٢ يوماً)" }, { status: 400 });

  // أيّامٌ لها إجازةُ يومٍ قائمةٌ (معلّقةٌ أو معتمدة) تُتخطّى ولا تُكرَّر
  const existing = await prisma.leave.findMany({
    where: { technicianId, kind: "day", isDeleted: false, status: { in: ["pending", "approved"] }, dayKey: { in: days } },
    select: { dayKey: true },
  });
  const taken = new Set(existing.map((x) => x.dayKey));
  const fresh = days.filter((d) => !taken.has(d));
  if (!fresh.length) {
    return NextResponse.json({ error: "كلُّ أيّام المدى لها إجازةٌ مسجّلةٌ سلفاً" }, { status: 400 });
  }

  // ⚠️ الحصّةُ تُفحَص **لكلّ شهرٍ على حدة**: مدىً يعبُر شهرَين يستهلك من حصّةِ كلٍّ
  //   منهما بأيّامه فيه. والفحصُ **قبل الإنشاء** لا بعده، فلا يُنشأ بعضٌ ويُرفَض بعضٌ.
  if (paid) {
    const quota = Math.max(0, tech.paidLeavesPerMonth ?? 0);
    const byMonth = new Map<string, number>();
    for (const d of fresh) byMonth.set(monthOf(d), (byMonth.get(monthOf(d)) ?? 0) + 1);
    for (const [m, want] of byMonth) {
      const used = await usedPaidThisMonth(technicianId, m);
      if (used + want > quota) {
        return NextResponse.json({
          error: `حصّةُ الإجازات المدفوعة في ${m}: ${quota} — المستهلَك ${used}، والمتبقّي ${Math.max(0, quota - used)}`
            + ` وأنت تمنح ${want}. قلّل المدى أو امنحها بلا راتب.`,
        }, { status: 400 });
      }
    }
  }

  const by = g.session.fullName ?? g.session.username;
  const now = new Date();
  await prisma.leave.createMany({
    data: fresh.map((dayKey) => ({
      technicianId, agentId: tech.agentId, towerId: tech.towerId,
      kind: "day", paid, dayKey, reason,
      status: "approved", decidedBy: by, decidedAt: now,
    })),
  });
  return NextResponse.json({
    ok: true, created: fresh.length, skipped: days.length - fresh.length,
    days: fresh, paid, technicianName: tech.name,
  });
}

// POST: الفنيُّ يطلب (يوم براتب/بلا أو زمنية)، **أو** المديرُ يمنح لفنيٍّ ولمدّةٍ (أ-٨)
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const tech = await getTechSession();
  // لا جلسةَ فنيّ + الطلبُ يحمل `technicianId` ⇒ مسارُ المدير. والترتيبُ مقصود:
  // جلسةُ الفنيّ تُقدَّم فلا يستطيع فنيٌّ منحَ نفسِه إجازةً معتمدةً بتمرير مُعرِّفه.
  if (!tech) return managerCreate(request, body);
  const parsed = z.object({
    kind: z.enum(["day", "time"]),
    paid: z.boolean().optional(),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح"),
    startMin: z.coerce.number().int().min(0).max(1440).optional(),
    endMin: z.coerce.number().int().min(0).max(1440).optional(),
    reason: z.string().trim().min(1, "السبب مطلوب"),
    // ⚠️ الجسمُ قُرئ مرّةً أعلى الدالّة (`body`) — وقراءتُه ثانيةً من `request` تُرجع
    //   فراغاً لأنّ التيّارَ يُستهلَك مرّةً واحدة، فتسقط كلُّ طلبات الفنيين.
  }).safeParse(body);
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
  const dup = await prisma.leave.findFirst({ where: { technicianId: tech.technicianId, kind: "day", dayKey, isDeleted: false, status: { in: ["pending", "approved"] } } });
  if (dup) return NextResponse.json({ error: "لديك إجازة يوم مسجّلة لهذا التاريخ" }, { status: 400 });

  const paid = !!parsed.data.paid; // (كان `let` ولا يُعاد إسنادُه — خطأُ eslint قديمٌ أُصلح بالمناسبة)
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
  const g = await guard("field.payroll");
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

  // ═════ البندان ٤ و٦ · موافقةُ المدير تمسح خصمَ ذلك اليوم (طلبُ محمد 2026-08-14) ═════
  // بنصّه: (٤) «إذا خُصم الموظّفُ لأنّ المديرَ لم ينتبه لأنّه طالبُ إجازةٍ زمنيّة، فموافقةُ
  // المدير **حتى لو بعد أكثرَ من يوم** ستمسح الخصمَ عن اليوم الذي خُصم به». و(٦) «موافقةُ
  // المدير تُزيل أيَّ خصمٍ بسبب أيّ حادث مخالفةِ بصمةٍ في الوقت الذي طلبه».
  //
  // 🔑 وهو **للزمنيّة** (`kind: "time"`): فالخصمُ عقوبةُ تأخيرٍ أو خروجٍ مبكّر، والإجازةُ
  //    الزمنيّةُ المعتمدةُ تُبيح ذلك الوقتَ بعينه. وإجازةُ اليوم الكامل لا بصمةَ فيها أصلاً.
  //
  // ⛔ **وقاعدةُ محمد الحاكمة: «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ له بعدها».**
  //    فيومٌ مختومٌ بكشفٍ **لا يُمسَح** — وتُعاد ملاحظةٌ صريحةٌ للواجهة (`sealedNotice`)
  //    فيعرف المديرُ أنّ موافقتَه سُجِّلت **والخصمُ باقٍ**. والصمتُ هنا أسوأُ من الرفض.
  let clearedAmount = 0;
  let sealedNotice: string | null = null;
  if (parsed.data.status === "approved" && leave.kind === "time" && leave.dayKey) {
    const rec = await prisma.attendance.findFirst({
      where: { technicianId: leave.technicianId, dayKey: leave.dayKey },
      select: { id: true, lateDeduction: true, earlyDeduction: true, salaryStatementId: true, deductionClearedAt: true },
      orderBy: { id: "desc" },
    });
    const total = (rec?.lateDeduction ?? 0) + (rec?.earlyDeduction ?? 0);
    if (rec && total > 0) {
      if (rec.salaryStatementId != null) {
        sealedNotice = `الخصمُ (${total}) لم يُمسَح: يومُ ${leave.dayKey} مختومٌ بكشف راتبٍ مصروف.`;
      } else {
        // الحَجزُ قبل الأثر — وبشرطِ أنّه لم يُمسَح سلفاً ولم يُختَم بين القراءة والكتابة
        const done = await prisma.attendance.updateMany({
          where: { id: rec.id, deductionClearedAt: null, salaryStatementId: null },
          data: {
            lateDeduction: 0, earlyDeduction: 0,
            deductionClearedBy: g.session.fullName ?? g.session.username,
            deductionClearedAt: new Date(),
            deductionClearReason: `موافقةُ إجازةٍ زمنيّة #${leave.id}`,
            deductionClearedAmount: total,
          },
        });
        if (done.count === 1) {
          clearedAmount = total;
          await prisma.auditLog.create({
            data: {
              userId: g.session.userId,
              action: "CLEAR_DEDUCTION",
              entity: "attendance",
              entityId: String(rec.id),
              details: `مسحُ خصمٍ ${total} بموافقة إجازةٍ زمنيّة #${leave.id} — يوم ${leave.dayKey}`,
            },
          }).catch(() => {});
        }
      }
    }
  }
  return NextResponse.json({ ok: true, leave: updated, clearedDeduction: clearedAmount, sealedNotice });
}

// ═════ أ-٨ · إزالةُ إجازةٍ أُدخلت خطأً (طلبُ محمد) ═════
// 🔴 كان النظامُ **بلا `DELETE` إطلاقاً**: `PATCH` يقبل/يرفض المعلَّقةَ وحدَها ويردّ
//   «الطلبُ مُقرَّرٌ مسبقاً» لما بعدها ⇒ إجازةٌ اعتُمدت خطأً **تبقى إلى الأبد** ومعها
//   يومٌ مدفوعٌ في راتب الفنيّ لا سبيلَ إلى نزعه.
// 🔒 والقيدُ الحاسم: **لا تُزال إجازةٌ مختومةٌ بكشفِ راتب** (`salaryStatementId != null`).
//   فالكشفُ سُدِّد وحُسب، ونزعُ سطرٍ منه بأثرٍ رجعيٍّ يُخالف رقماً دُفع فعلاً. ومَن أراد
//   ذلك فطريقُه الصحيحُ إلغاءُ الكشف (الإرجاعُ العكسيُّ الكامل) ثمّ الإزالة.
// 🔒 والإزالةُ **ناعمةٌ**: مَن أزالها ومتى يبقيان مكتوبَين، فلا تختفي واقعةٌ من السجلّ.
export async function DELETE(request: Request) {
  const g = await guard("field.payroll");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });

  const leave = await prisma.leave.findUnique({
    where: { id },
    select: { id: true, towerId: true, isDeleted: true, salaryStatementId: true, dayKey: true, paid: true, kind: true },
  });
  // 🔒 العزل: مكتبُ الإجازة يجب أن يكون من مكاتب المستخدم — وإلّا فهي «غير موجودة»
  if (!leave || leave.isDeleted || !(await ownsTower(g.session, leave.towerId))) {
    return NextResponse.json({ error: "الإجازة غير موجودة" }, { status: 404 });
  }
  if (leave.salaryStatementId != null) {
    return NextResponse.json({
      error: "هذه الإجازة محسوبةٌ في كشفِ راتبٍ مُسدَّد — أَلغِ الكشفَ أوّلاً (إرجاعٌ عكسيٌّ كامل) ثمّ أزِلها.",
    }, { status: 400 });
  }

  const session = await getSession();
  await prisma.leave.update({
    where: { id: leave.id },
    data: { isDeleted: true, deletedBy: session?.fullName ?? session?.username ?? null, deletedAt: new Date() },
  });
  return NextResponse.json({ ok: true, removed: { id: leave.id, dayKey: leave.dayKey, paid: leave.paid, kind: leave.kind } });
}
