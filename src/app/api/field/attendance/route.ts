import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { baghdadDayKey, computeAttendance, parseHHMM, baghdadMinutesOfDay } from "@/lib/attendance";
import { notify } from "@/lib/notify";
import { endSupport, techEffectiveOffices, approvedTimeLeaveFor } from "@/lib/field";
import { decideStampOffice, fallbackOffice, type StampResult } from "@/app/api/_lib/stampOffice";

export const dynamic = "force-dynamic";

// ⚠️ `geofenceError` القديمةُ نُزعت هنا: كانت تفحص **مكتباً واحداً أُلزم به الفنيُّ سلفاً**،
// وقد صار الفحصُ الجغرافيُّ وحسمُ المكتب **عمليّةً واحدةً** في `resolveStampOffice` أدناه.
// وإبقاؤها يعني تعريفَين لقاعدةٍ جغرافيّةٍ واحدةٍ يتباعدان مع أوّل تعديل.

// ═══════════════ أ-١٠ · مكتبُ البصمة يُحسم من موقعه الفعليّ ═══════════════
// **القاعدةُ الحاكمة (قرارُ محمد 2026-08-11):** «يستطيع بصمَ دخولٍ من مكتبٍ والخروجَ من مكتبٍ
// آخر، **وكلُّ الإجراءات ترجع إلى مكتبه الأصليّ وكأنّه بصم من مكتبه الأصليّ**.»
//
// 🔴 **والعلّةُ التي يُصلحها هذا البند**: كان السطرُ الواحد `t?.supportTowerId ?? tech.towerId`
// **يتجاهل `supportKind`**. ودعمُ «بطاقاتٍ محدّدة» تُبقي اللوحةُ صاحبَه في مكتبه الأصليّ —
// فكان يُلزَم بالبصم في مكتب الطالب، ونطاقُه الجغرافيُّ يُقاس على ذلك المكتب، **فيُمنَع من
// البصم في مكتبه الذي هو فيه** ⇒ لا صفَّ حضورٍ ⇒ **لا يومَ راتبٍ له**. (وقياسُ الإنتاج
// 2026-08-13: خمسةٌ من تسعةِ مكاتبَ نطاقُها مُفعَّلٌ بـ٥٠ متراً — فهناك تعضُّ العلّةُ بقوّة.)
//
// والحلُّ: **لا يُلزَم بمكتبٍ، بل يُحسَم مكتبُه من موقعه** بين مكاتبه المسموحة.
// ⚠️ ولا يُقبَل `officeId` من جسم الطلب أبداً — المجموعةُ تُبنى في الخادم من
// `techEffectiveOffices`، وإلّا بصم أيُّ فنيٍّ على أيّ مكتب (وهي عينُ طبقة العزل).
async function resolveStampOffice(
  t: { supportTowerId: number | null; supportKind: string | null; extraTowerIds: string | null },
  homeTower: number | null,
  agentTowers: number[],
  lat: number | undefined,
  lng: number | undefined,
): Promise<StampResult> {
  const fallback = fallbackOffice(t, homeTower);
  const allowed = techEffectiveOffices({ towerId: homeTower, supportTowerId: t.supportTowerId, extraTowerIds: t.extraTowerIds });
  if (!allowed.length) return { office: fallback };

  // 🛡️ ترشيحان أضافهما التدقيقُ العدائيّ:
  // (١) **العزل**: `techEffectiveOffices` تجمع `towerId`+`extraTowerIds`+`supportTowerId`
  //     **بلا أيّ تحقّقٍ من الوكيل**. فلو حُشي أحدُها بمكتب وكيلٍ آخر (خطأً أو عبثاً) لبصم
  //     الفنيُّ عليه. والعزلُ لا يكون مشروطاً بحُسن الإدخال.
  //     ⚠️ وإن تعذّر معرفةُ مكاتب وكيله (قائمةٌ فارغة) **لا نُقصِّ إلى صفر** — فذلك يمنع
  //     البصمةَ كلَّها ويُسقط يومَ راتبٍ لعلّةٍ في القراءة لا في الفنيّ.
  const scoped = agentTowers.length ? allowed.filter((x) => agentTowers.includes(x)) : allowed;
  const towers = await prisma.tower.findMany({
    // (٢) `isDeleted: false` — مكتبٌ محذوفٌ ناعماً كان يبقى في مجموعة الحسم فيسحب البصمةَ
    //     إليه بموقعه القديم، أو يفرض نطاقاً على مكتبٍ لم يعد موجوداً.
    where: { id: { in: scoped.length ? scoped : [-1] }, isDeleted: false },
    select: { id: true, name: true, geoEnabled: true, lat: true, lng: true, geoRadius: true },
  });
  return decideStampOffice(towers, fallback, lat, lng);
}

// سجل حضور فني ليوم اليوم (أو ينشئه)
async function todayRecord(technicianId: number) {
  const key = baghdadDayKey(new Date());
  return prisma.attendance.findFirst({ where: { technicianId, dayKey: key }, orderBy: { id: "desc" } });
}

// ═══════════════════ أ-٢٥ · الفنيُّ يُغلق سجلَّ أمسِ المفتوح ═══════════════════
// بلاغُ محمد (عليّ السجاد 2026-08-13): «بصم خروجاً ولم يظهر لي، وفي تطبيقه بصمةُ دخولٍ خضراء».
// والبياناتُ نفت البصمةَ ونفت معها الظنّ: **لم يبصم خروجاً**، والأخضرُ معناه «عليك بصمةُ دخول».
// والعلّةُ بنيويّة: هذا المسار كان يقرأ **سجلَّ اليوم وحدَه**، فمَن دوامُه ينتهي ٢٣:٠٠ وتجاوز
// منتصفَ الليل يفقد زرَّ الخروج **تماماً** فلا يستطيع إغلاقَ سجلّه أبداً. وسجلُّ عليٍّ يُثبت
// أنّ هذا معتادُه (٢٣:٤٢ · ٢٢:٥٧) ⇒ الحادثةُ متوقّعةُ التكرار لكلّ فنيٍّ مسائيّ.
//
// ونافذةُ السماح **محدودةٌ بثلاث ساعاتٍ بعد نهاية دوامه** كي لا تُفتح ثغرةُ تلاعب: فلا يعود
// أحدٌ بعد يومَين ليُغلق سجلّاً قديماً. ومَن فاتته النافذةُ يُصلَح له بأ-٢٤ (المديرُ يُسجّل
// خروجَه الفعليَّ لأيّ يوم).
//
// 🔑 وفائدةٌ لم تكن مقصودة: الدوامُ الذي **يعبر منتصفَ الليل** (٢٢:٠٠ ← ٠٦:٠٠) كان يفقد زرَّه
// في منتصف دوامه — وهذا يُصلحه أيضاً.
const LATE_CLOSE_GRACE_HOURS = 3;

/** نهايةُ دوامِ يومٍ بعينه (UTC). وتُعالِج الدوامَ الذي ينتهي قبل بدايته ⇒ نهايتُه غداً. */
function shiftEndUtc(dayKey: string, shiftStart: string | null, shiftEnd: string | null): Date {
  const endMin = parseHHMM(shiftEnd);
  // بلا دوامٍ محدَّد ⇒ تُحسَب النهايةُ منتصفَ ليل ذلك اليوم (فالنافذةُ حتى ٠٣:٠٠)
  if (endMin == null) return bgTimeUtc(dayKey, 24 * 60);
  const startMin = parseHHMM(shiftStart);
  const crossesMidnight = startMin != null && endMin <= startMin;
  return bgTimeUtc(dayKey, endMin + (crossesMidnight ? 24 * 60 : 0));
}

/** سجلُّ يومٍ ماضٍ **ما زال مفتوحاً** ونافذةُ سماحه لم تنتهِ — أو `null`. */
async function lateOpenRecord(technicianId: number, t?: { shiftStart: string | null; shiftEnd: string | null } | null) {
  const key = baghdadDayKey(new Date());
  const prev = await prisma.attendance.findFirst({
    where: { technicianId, dayKey: { not: null, lt: key }, checkIn: { not: null }, checkOut: null },
    orderBy: { dayKey: "desc" },
  });
  if (!prev?.dayKey || !prev.checkIn) return null;
  const tech = t ?? await prisma.technician.findUnique({ where: { id: technicianId }, select: { shiftStart: true, shiftEnd: true } });
  const endAt = shiftEndUtc(prev.dayKey, tech?.shiftStart ?? null, tech?.shiftEnd ?? null);
  const deadline = endAt.getTime() + LATE_CLOSE_GRACE_HOURS * 3600 * 1000;
  if (Date.now() > deadline) return null; // فاتت النافذة ⇒ يُصلَح بأ-٢٤ من المدير
  return { rec: prev, dayKey: prev.dayKey, endAt };
}
function stateOf(rec: { checkIn: Date | null; checkOut: Date | null } | null): "none" | "in" | "done" {
  if (!rec || !rec.checkIn) return "none";
  return rec.checkOut ? "done" : "in";
}

// GET: للفني → حالة يومه. للمدير/الموظف → حضور فنيّي المكتب اليوم.
// أ-٧ · مُرشِّحُ المدى للسجلّ: `from`/`to` بصيغة YYYY-MM-DD (dayKey نصٌّ يقارَن زمنيّاً)
function dayRangeOf(url: URL): { gte?: string; lte?: string } | undefined {
  const ok = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const from = ok(url.searchParams.get("from"));
  const to = ok(url.searchParams.get("to"));
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    // ═════ أ-٧ · «وفي تطبيق الفنيّ تظهر له **كلُّ** بصماته لا المؤثِّرة فقط» ═════
    // كانت جلسةُ الفنيّ تُرجع حالةَ **يومه** حصراً، فلا سبيلَ له لمراجعة سجلّه.
    // 🔒 والعزلُ ضمنيٌّ تامّ: السجلُّ من `tech.technicianId` (جلستُه) — لا معرّفَ يُقبَل منه.
    const u = new URL(request.url);
    if (u.searchParams.get("log") === "1") {
      const range = dayRangeOf(u);
      const recs = await prisma.attendance.findMany({
        where: { technicianId: tech.technicianId, ...(range ? { dayKey: range } : {}) },
        orderBy: { dayKey: "desc" },
        select: {
          id: true, dayKey: true, checkIn: true, checkOut: true, checkInActual: true, checkOutActual: true,
          lateDeduction: true, earlyDeduction: true, overtimeAddition: true, lateExcuse: true, checkoutBy: true,
        },
        take: range ? 400 : 120,
      });
      return NextResponse.json({ role: "technician", log: recs });
    }
    const rec = await todayRecord(tech.technicianId);
    // أ-٢٥ · لا سجلَّ لليوم؟ فلعلّه لم يُغلق سجلَّ أمس — يُعرَض عليه ليُغلقه، و`lateDay`
    // يُخبر الشريطَ أنّ الخروجَ هذا **لأمس** فلا يظنّه خروجَ اليوم.
    const late = rec?.checkIn ? null : await lateOpenRecord(tech.technicianId);
    const use = rec?.checkIn ? rec : (late?.rec ?? rec);
    return NextResponse.json({
      role: "technician", state: stateOf(use),
      checkIn: use?.checkIn ?? null, checkOut: use?.checkOut ?? null,
      lateDay: rec?.checkIn ? null : (late?.dayKey ?? null),
    });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const url = new URL(request.url);
  // سجل بصمات فنيٍّ محدّد (للمدير): كل بصماته بتاريخها ووقتَي الدخول/الخروج
  const logTechId = Number(url.searchParams.get("technicianId")) || null;
  if (logTechId) {
    const t = await prisma.technician.findUnique({ where: { id: logTechId } });
    if (!t || t.isDeleted || !(await ownsTower(session, t.towerId))) {
      return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
    }
    // أ-٧ · «وبحثٌ بين تاريخين لمراجعة بصماتٍ أقدم» — بلا المدى تبقى آخرُ ١٢٠ يوماً كما كانت
    const range = dayRangeOf(url);
    const recs = await prisma.attendance.findMany({
      where: { technicianId: logTechId, ...(range ? { dayKey: range } : {}) },
      orderBy: { dayKey: "desc" },
      select: { id: true, dayKey: true, checkIn: true, checkInActual: true, checkOut: true, checkOutActual: true, checkoutBy: true, lateExcuse: true, lateDeduction: true, earlyDeduction: true, salaryStatementId: true, deductionClearedBy: true, deductionClearedAt: true, deductionClearReason: true, deductionClearedAmount: true,
        // أ-١٠/القاعدة ٣ · تُقرأ الآن وتُعرَض: **أين** بصم — و`towerId` **لمن** يُحتسَب
        towerId: true, checkInTowerId: true, checkOutTowerId: true },
      take: range ? 400 : 120, // بمدىً صريحٍ يُسمح بأوسع (مراجعةُ أشهرٍ ماضية)
    });
    // أسماءُ المكاتب الظاهرة في السجلّ — **من مكاتب وكيل المستخدم حصراً** (عزل)
    const agentT = await agentTowerIds(session);
    const named = await prisma.tower.findMany({
      where: { id: { in: agentT.length ? agentT : [-1] } }, select: { id: true, name: true },
    });
    const oname = new Map(named.map((o) => [o.id, o.name]));
    // ولا يُعرَض اسمُ مكتبٍ إلّا حين **يختلف** عن مكتبه الأصليّ: فالمعتادُ ألّا يختلف،
    // وعرضُه دائماً يُغرِق السجلَّ بتكرارٍ لا يُقرأ.
    const elsewhere = (stamp: number | null, home: number | null) =>
      stamp != null && home != null && stamp !== home ? (oname.get(stamp) ?? "مكتبٌ آخر") : null;
    return NextResponse.json({
      role: "manager",
      log: recs.map((r) => ({
        ...r,
        inOffice: elsewhere(r.checkInTowerId, r.towerId),
        outOffice: elsewhere(r.checkOutTowerId, r.towerId),
      })),
    });
  }
  const reqOffice = Number(url.searchParams.get("officeId")) || null;
  const key = baghdadDayKey(new Date());
  const agentTowers = await agentTowerIds(session);
  // عزل الوكيل: لا يُعرض حضور مكتبٍ لا يتبع وكيل المستخدم
  if (reqOffice && !agentTowers.includes(reqOffice)) {
    return NextResponse.json({ error: "لا يمكنك عرض حضور مكتب آخر" }, { status: 403 });
  }
  const where = reqOffice
    ? { towerId: reqOffice, isDeleted: false }
    : { towerId: { in: agentTowers.length ? agentTowers : [-1] }, isDeleted: false };
  const techs = await prisma.technician.findMany({ where, select: { id: true, name: true, shiftStart: true, shiftEnd: true, towerId: true }, orderBy: { id: "asc" } });
  const techIds = techs.map((t) => t.id);
  const recs = await prisma.attendance.findMany({ where: { technicianId: { in: techIds }, dayKey: key } });
  const byTech = new Map(recs.map((r) => [r.technicianId, r]));
  // ═════ البند ٩ · «مَن لم يبصم خروجاً فهو معلَّقٌ ولو من أمس» (طلبُ محمد 2026-08-14) ═════
  // بنصّه: «يظهر سجلُّ حضور اليوم، **وأيضاً مَن لم يبصم خروجاً حتى الآن فهو لا يزال
  // معلَّقاً مع بصمات يوم أمس. وإذا بُصِم خروجُه من المدير أو خروجٌ تلقائيّ فلا يظهر».
  // 🔑 وصفٌّ مفتوحٌ من أمسِ **حدثٌ قائمٌ لا تاريخٌ**: يومُ عملٍ لم يُغلَق بعد، وإخفاؤه
  //    لأنّ تاريخَه ليس اليومَ يجعل المديرَ لا يراه إلّا في السجلّ — وهو ما اشتكى منه.
  // ونافذةُ ٧ أيّامٍ: أقدمُ من ذلك ليس «معلَّقاً» بل صفٌّ منسيٌّ يُعالَج من السجلّ.
  const openSince = new Date(Date.now() - 7 * 86400_000);
  const openRecs = await prisma.attendance.findMany({
    where: {
      technicianId: { in: techIds.length ? techIds : [-1] }, // 🔒 نفسُ نطاق العزل أعلاه
      dayKey: { not: key },
      checkIn: { not: null },
      checkOut: null, // لم يُبصَم خروجُه — لا بيد المدير ولا آليّاً
      createdAt: { gte: openSince },
    },
    orderBy: { dayKey: "desc" },
  });
  // أ-١ · واسمُ المكتب يُرجَع مع كلّ فنيّ: الشاشةُ تُظهر فنيّي **كلّ المكاتب** معاً
  // (طلبُ محمد)، وبلا اسمِ المكتب تصير قائمةً بأسماءَ لا يُعرَف أيُّها لأيّ مكتب.
  const oNames = new Map(
    (await prisma.tower.findMany({
      where: { id: { in: [...new Set(techs.map((t) => t.towerId).filter((x): x is number => x != null))] } },
      select: { id: true, name: true },
    })).map((o) => [o.id, o.name]),
  );
  return NextResponse.json({
    role: "manager",
    technicians: techs.map((t) => {
      const r = byTech.get(t.id) ?? null;
      return {
        id: t.id, name: t.name, shiftStart: t.shiftStart, shiftEnd: t.shiftEnd,
        state: stateOf(r), checkIn: r?.checkIn ?? null, checkOut: r?.checkOut ?? null,
        towerId: t.towerId, office: t.towerId != null ? (oNames.get(t.towerId) ?? null) : null,
        // ولحظةُ البصمة الحقيقيّةُ ومَن أخرجه — يُقرآن في الشاشة تمييزاً للخروج الآليّ
        checkInActual: r?.checkInActual ?? null, checkOutActual: r?.checkOutActual ?? null,
        checkoutBy: r?.checkoutBy ?? null, lateExcuse: r?.lateExcuse ?? null,
      };
    }),
    // البند ٩ · أيّامٌ سابقةٌ لم تُغلَق — تُعرَض مع حضور اليوم لا في السجلّ وحدَه
    open: openRecs.map((r) => {
      const t = techs.find((x) => x.id === r.technicianId);
      return {
        id: r.technicianId, name: t?.name ?? null, dayKey: r.dayKey,
        shiftStart: t?.shiftStart ?? null, shiftEnd: t?.shiftEnd ?? null,
        state: "in" as const, checkIn: r.checkIn, checkOut: null,
        checkInActual: r.checkInActual, checkOutActual: null,
        checkoutBy: r.checkoutBy, lateExcuse: r.lateExcuse,
        towerId: t?.towerId ?? null, office: t?.towerId != null ? (oNames.get(t.towerId) ?? null) : null,
      };
    }),
  });
}

// POST (فني فقط): بصمة دخول/خروج بوقت الخادم (بغداد)
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = z.object({ action: z.enum(["in", "out", "excuse"]), lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "إجراء غير صحيح" }, { status: 400 });

  // بيانات الفني (بما فيها الدعم) — البصمة تتحوّل لمكتب الدعم إن كان الفني مُعاراً
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { towerId: true, supportTowerId: true, supportKind: true, extraTowerIds: true, shiftStart: true, shiftEnd: true, entryGraceMin: true, exitGraceMin: true, lateRatePerMin: true, overtimeRatePerMin: true } });
  // أ-١٠/القاعدة ٢ · **مكتبُه الأصليُّ هو مرجعُ كلّ شيء**: النسبةُ والراتبُ والتقاريرُ
  // والإشعارات — «وكأنّه بصم من مكتبه الأصليّ». ويُقرأ من القاعدة لا من الجلسة، فالجلسةُ
  // تبقى حاملةً المكتبَ القديم لو نقله المديرُ وهي مفتوحة.
  const homeTower = t?.towerId ?? tech.towerId;
  const onSupport = t?.supportTowerId != null;

  // إجراء «نسيت البصمة»: طلب إعفاء من خصم تأخير الدخول (لا يحتاج موقعاً) — يبقى معلّقاً حتى قرار المدير
  if (parsed.data.action === "excuse") {
    const rec0 = await todayRecord(tech.technicianId);
    if (!rec0?.checkIn) return NextResponse.json({ error: "لا توجد بصمة دخول اليوم" }, { status: 400 });
    if (rec0.lateExcuse) return NextResponse.json({ error: "الطلب مُرسَل مسبقاً — بانتظار قرار المدير" }, { status: 400 });
    const startMin0 = parseHHMM(t?.shiftStart);
    const grace0 = Math.max(0, t?.entryGraceMin ?? 0);
    if (startMin0 == null || baghdadMinutesOfDay(rec0.checkIn) <= startMin0 + grace0) {
      return NextResponse.json({ error: "لا يوجد تأخير على بصمة دخولك" }, { status: 400 });
    }
    await prisma.attendance.update({ where: { id: rec0.id }, data: { lateExcuse: "pending" } });
    await notify({ agentId: tech.agentId, towerId: rec0.towerId, type: "deduction", title: "طلب «نسيت البصمة»", body: `${tech.name}: طلب إعفاء من خصم تأخير الدخول`, refType: "technician", refId: tech.technicianId, url: "/field-management?open=deductions" });
    return NextResponse.json({ ok: true, lateExcuse: "pending" });
  }

  // أ-١٠ · البصمةُ الجغرافيّةُ **وحسمُ المكتب** صارا عمليّةً واحدة: يُقاس موقعُه على **كلّ**
  // مكاتبه المسموحة فيُعرَف في أيّها هو، بدل أن يُقاس على مكتبٍ واحدٍ أُلزم به سلفاً.
  // مكاتبُ وكيلِ الفنيّ — سياجُ العزل على مجموعة الحسم (وجلسةُ الفنيّ ليست جلسةَ مستخدمٍ
  // فلا تصلح لها `agentTowerIds`، فتُقرأ مباشرةً).
  const agentTowers = tech.agentId != null
    ? (await prisma.tower.findMany({ where: { agentId: tech.agentId, isDeleted: false }, select: { id: true } })).map((o) => o.id)
    : [];
  const stamp = await resolveStampOffice(
    { supportTowerId: t?.supportTowerId ?? null, supportKind: t?.supportKind ?? null, extraTowerIds: t?.extraTowerIds ?? null },
    homeTower, agentTowers, parsed.data.lat, parsed.data.lng,
  );
  if (stamp.error) return NextResponse.json({ error: stamp.error }, { status: 403 });
  const stampOffice = stamp.office; // **مكانُ** البصمة — للشفافيّة والتوزيع، لا للنسبة

  const now = new Date();
  const key = baghdadDayKey(now);
  const rec = await todayRecord(tech.technicianId);

  if (parsed.data.action === "in") {
    if (rec?.checkIn) return NextResponse.json({ error: "سجّلت دخولك اليوم مسبقاً" }, { status: 400 });
    // معالجة الدخول المبكر: إن بصم قبل بدء الدوام، يُسجَّل الدخول المُحتسَب في موعد الدوام
    // (لا في وقته المبكر) فلا فائدة من التبكير؛ والوقت الحقيقي يُحفظ في checkInActual للسجل.
    const startMin = parseHHMM(t?.shiftStart);
    const effectiveIn = (startMin != null && baghdadMinutesOfDay(now) < startMin) ? bgTimeUtc(key, startMin) : now;
    const created = await prisma.attendance.create({
      // القاعدة ٢: `towerId` = **المكتبُ الأصليّ** لا مكتبُ البصمة — فالراتبُ والتقاريرُ
      // ترجع إليه «كأنّه بصم من مكتبه». والقاعدة ٣: `checkInTowerId` يحفظ **أين** بصم فعلاً.
      data: { technicianId: tech.technicianId, agentId: tech.agentId, towerId: homeTower, checkInTowerId: stampOffice, dayKey: key, checkIn: effectiveIn, checkInActual: now, checkoutBy: null },
    });
    // كشف التأخّر (على الوقت المُحتسَب): دخول بعد (بدء الدوام + سماحية الدخول) ⇒ زر «هل نسيت البصمة؟»
    const isLate = startMin != null && baghdadMinutesOfDay(effectiveIn) > startMin + Math.max(0, t?.entryGraceMin ?? 0);
    // الإشعارُ لمكتبه الأصليّ: كان ينزح لمكتب الدعم فلا يرى مديرُ المكتب الأصليّ بصمةَ فنيّه
    await notify({ agentId: tech.agentId, towerId: homeTower, type: "checkin", title: "بصمة دخول", body: `${tech.name} سجّل الدخول${onSupport ? " (دعم)" : ""}${isLate ? " (متأخّر)" : ""}`, refType: "technician", refId: tech.technicianId });
    // بطاقات الليل والفجر: تُرفع حين لا أحد على رأس عمله فتبقى بلا فني. نلتقطها **هنا**
    // — لحظة أول بصمة دخول — بدل مهمة خلفية دورية تُبقي الخادم مستيقظاً وتكلّف على
    // الخطة المجانية. الطلب موجود أصلاً كل صباح، فالكلفة الإضافية صفر (قرار محمد 2026-08-03).
    let assignedPending = 0;
    try {
      const { distributePending } = await import("@/lib/autoAssign");
      assignedPending = await distributePending(stampOffice, tech.agentId ?? null);
    } catch { /* لا يُفشل البصمة إطلاقاً */ }
    return NextResponse.json({ ok: true, state: "in", checkIn: created.checkIn, late: isLate, canExcuse: isLate, assignedPending });
  }

  // خروج
  // أ-٢٥ · لا سجلَّ لليوم ⇒ يُقبَل إغلاقُ سجلّ أمسِ المفتوح داخل نافذة السماح.
  // ⚠️ ولا يُمَسُّ فرعُ الدخول أعلاه بهذا إطلاقاً: لو صار `rec` يعني سجلَّ أمسِ المفتوح
  // لقال السطرُ ١١٩ للفنيّ «سجّلتَ دخولك اليوم مسبقاً» **فيُحجَب عن دخول يومه الجديد**.
  const lateOpen = rec?.checkIn ? null : await lateOpenRecord(tech.technicianId, t);
  const outRec = rec?.checkIn ? rec : (lateOpen?.rec ?? rec);
  const lateDay = rec?.checkIn ? null : (lateOpen?.dayKey ?? null);

  if (!outRec?.checkIn) return NextResponse.json({ error: "سجّل دخولك أولاً" }, { status: 400 });
  if (outRec.checkOut) return NextResponse.json({ error: "سجّلت خروجك مسبقاً" }, { status: 400 });

  // 🔑 وقتُ الخروج المُحتسَب: في الإغلاق المتأخّر **يُقصُّ عند نهاية الدوام** — فلا إضافيَّ
  // على ساعاتٍ لم يعملها (وإلّا صار النسيانُ مُربِحاً)، ولا خصمَ خروجٍ مبكّرٍ ظُلماً.
  // و`checkOutActual` يبقى **لحظةَ النقر الحقيقيّة** فيبقى الأثرُ صادقاً ويُراجَع.
  // ومَن عمل فعلاً بعد دوامه يُصحّح له المديرُ بأ-٢٤ — ولذلك `checkoutBy = "tech-late"`
  // لا `"tech"`: فالـPATCH يرفض تعديلَ ما وسمُه `"tech"` («شهادةُ الفنيّ لا تُمَسّ»)،
  // ولو وسمتُه به لأغلقتُ بابَ التصحيح على المدير في نفس النَفَس الذي فتحتُه للفنيّ.
  const outAt = lateDay && lateOpen
    ? new Date(Math.min(now.getTime(), lateOpen.endAt.getTime()))
    : now;
  // الإجازةُ الزمنيّةُ المعتمدةُ لذلك اليوم تُزيح حدَّ الدوام فيسقط خصمُ وقتِها (طلبُ محمد)
  const outLeave = t ? await approvedTimeLeaveFor(tech.technicianId, outRec.dayKey) : null;
  const calc = t ? computeAttendance(t, outRec.checkIn, outAt, outLeave) : null;
  // دعم يومٍ طُلب بعد بصمة دخوله بمكتبه الأصلي: الدخول يبقى لمكتبه، والخروج يُنسب لمكتب الدعم
  // القاعدة ٣ · **مكانُ** الخروج يُحفَظ دائماً لا حين يختلف فقط: كان `null` يعني «نفسَ
  // المكتب» فلا يُعرَف يقيناً أين بصم، وكان **يُكتَب ولا يُقرَأ** أصلاً. والآن يُقرأ ويُعرَض.
  const outTower = stampOffice;
  const updated = await prisma.attendance.update({
    where: { id: outRec.id },
    data: { checkOut: outAt, checkOutActual: now, checkoutBy: lateDay ? "tech-late" : "tech", checkOutTowerId: outTower, ...(calc ?? {}) },
  });
  const late = calc?.lateDeduction ?? 0, early = calc?.earlyDeduction ?? 0, ot = calc?.overtimeAddition ?? 0;
  const extra = late || early ? ` (خصم ${(late + early).toLocaleString("en-US")})` : ot ? ` (إضافي ${ot.toLocaleString("en-US")})` : "";
  await notify({ agentId: tech.agentId, towerId: homeTower, type: "checkout", title: lateDay ? "بصمة خروج متأخّرة" : "بصمة خروج", body: `${tech.name} سجّل الخروج${lateDay ? ` عن يوم ${lateDay} (بعد منتصف الليل)` : ""}${extra}`, refType: "technician", refId: tech.technicianId });

  // إن كان على دعم: الخروج ينهي الدعم ويعيده لمكتبه الأصلي (في كل الأحوال بنهاية الدوام)
  if (onSupport) {
    await endSupport(tech.technicianId);
    await notify({ agentId: tech.agentId, towerId: tech.towerId, type: "checkout", title: "انتهاء الدعم", body: `${tech.name} أنهى الدعم وعاد لمكتبه`, refType: "technician", refId: tech.technicianId });
  }
  return NextResponse.json({ ok: true, state: "done", checkOut: updated.checkOut, calc, supportEnded: onSupport });
}

// وقت (UTC) لدقيقةٍ من يوم بغداد المحدّد (YYYY-MM-DD)
function bgTimeUtc(dayKey: string, minutesOfDay: number): Date {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const bgMidnightUtc = Date.UTC(y, mo - 1, d, 0, 0, 0) - 3 * 3600 * 1000;
  return new Date(bgMidnightUtc + minutesOfDay * 60 * 1000);
}

// PATCH (المدير فقط): بصمة خروج يدوية (now/scheduled)، أو إضافة بصمة يوم كامل لتاريخٍ يختاره (addDay).
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({
    technicianId: z.coerce.number(),
    // أ-٢٤ · «custom» = وقتُ الخروج الفعليّ الذي يُدخله المدير (طلب محمد 2026-08-13)
    mode: z.enum(["now", "scheduled", "custom"]).optional(),
    at: z.string().regex(/^\d{2}:\d{2}$/).optional(), // HH:MM بغداد — مع mode=custom
    outDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // يومُ البصمة المُصحَّحة (فارغ = اليوم)
    addDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    excuseDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // يوم طلب «نسيت البصمة»
    excuse: z.enum(["approve", "reject"]).optional(), // قرار المدير على الطلب
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  // قرار المدير على طلب «نسيت البصمة»: قبول ⇒ إعادة الدخول لوقته المحدّد (صفر خصم)؛ رفض ⇒ يُثبَّت الخصم
  if (parsed.data.excuseDay && parsed.data.excuse) {
    const rec = await prisma.attendance.findFirst({ where: { technicianId: t.id, dayKey: parsed.data.excuseDay } });
    if (!rec?.checkIn) return NextResponse.json({ error: "لا توجد بصمة لهذا اليوم" }, { status: 404 });
    if (rec.lateExcuse !== "pending") return NextResponse.json({ error: "الطلب مُقرَّر مسبقاً" }, { status: 400 });
    if (parsed.data.excuse === "reject") {
      await prisma.attendance.update({ where: { id: rec.id }, data: { lateExcuse: "rejected" } });
      return NextResponse.json({ ok: true, excuse: "rejected" });
    }
    // قبول: يُعاد وقت الدخول إلى بدء دوامه ⇒ يُلغى تأخيره؛ ويُعاد حساب اليوم إن كان خرج
    const startMin = parseHHMM(t.shiftStart);
    const newCheckIn = startMin != null ? bgTimeUtc(parsed.data.excuseDay, startMin) : rec.checkIn;
    const recalc = rec.checkOut ? computeAttendance(t, newCheckIn, rec.checkOut) : {};
    await prisma.attendance.update({ where: { id: rec.id }, data: { checkIn: newCheckIn, lateExcuse: "approved", ...recalc } });
    return NextResponse.json({ ok: true, excuse: "approved" });
  }

  // إضافة بصمة يوم كامل (دخول=بدء الدوام، خروج=نهايته) — بلا خصم/إضافي
  if (parsed.data.addDay) {
    const startMin = parseHHMM(t.shiftStart), endMin0 = parseHHMM(t.shiftEnd);
    if (startMin == null || endMin0 == null) return NextResponse.json({ error: "حدّد دوام الفني (بداية/نهاية) أولاً" }, { status: 400 });
    const checkIn = bgTimeUtc(parsed.data.addDay, startMin);
    const checkOut = bgTimeUtc(parsed.data.addDay, endMin0 <= startMin ? endMin0 + 1440 : endMin0);
    const calc = computeAttendance(t, checkIn, checkOut); // أوقات الدوام بالضبط ⇒ صفر خصم/إضافي
    const existing = await prisma.attendance.findFirst({ where: { technicianId: t.id, dayKey: parsed.data.addDay } });
    if (existing) await prisma.attendance.update({ where: { id: existing.id }, data: { checkIn, checkOut, checkoutBy: "manager", ...calc } });
    else await prisma.attendance.create({ data: { technicianId: t.id, agentId: t.agentId, towerId: t.towerId, dayKey: parsed.data.addDay, checkIn, checkOut, checkoutBy: "manager", ...calc } });
    return NextResponse.json({ ok: true, addedDay: parsed.data.addDay });
  }

  // ===== أ-٢٤ · بصمةُ خروجٍ يدويّة — ولأيّ يومٍ في السجل لا لليوم وحده =====
  // 🔴 العلّةُ التي بلّغ عنها محمد («الميزةُ كانت موجودةً ولا أعلم لم لا تظهر»): كانت مقصورةً
  // على **بصمة اليوم المفتوحة**، وكرونُ `auto-checkout` يُغلق كلَّ مفتوحةٍ عند ٠٠:١٥ بغداد
  // بـ`checkoutBy: "auto"`. فحين ينتبه المديرُ صباحاً أنّ الفنيَّ نسي، الكرونُ قد أغلقها ⇒
  // اختفى القسمُ من الواجهة، وردَّ الخادمُ «سُجّل الخروج مسبقاً». فالنافذةُ كانت تُغلق قبل الحاجة.
  // ✅ الآن: يُقبل تصحيحُ أيّ يومٍ، **وتُصحَّح بصمةُ الكرون** — ولا تُمَسّ بصمةُ الفنيّ الحقيقيّة
  //    (`checkoutBy === "tech"`) أبداً، فهي شهادةُ حضورٍ ببصمته لا يجوز للمدير طمسُها.
  const outDay = parsed.data.outDay ?? null;
  const rec = outDay
    ? await prisma.attendance.findFirst({ where: { technicianId: t.id, dayKey: outDay } })
    : await todayRecord(t.id);
  if (!rec?.checkIn) return NextResponse.json({ error: "لا توجد بصمة دخول لهذا اليوم" }, { status: 400 });
  if (rec.checkOut && rec.checkoutBy === "tech") {
    return NextResponse.json({ error: "الفنيّ سجّل خروجه ببصمته — لا يُعدَّل" }, { status: 400 });
  }

  // يومُ بغداد الذي تنتمي إليه بصمةُ الدخول — أساسُ كلّ حسابٍ زمنيٍّ أدناه
  const b = new Date(rec.checkIn.getTime() + 3 * 3600 * 1000);
  // منتصفُ ليل بغداد لذلك اليوم بالـUTC (00:00 بغداد = 21:00 UTC اليوم السابق)
  const bgMidnightUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 0, 0, 0) - 3 * 3600 * 1000;

  let checkoutAt = new Date();
  if (parsed.data.mode === "scheduled") {
    // نهايةُ الدوام المحدّدة لهذا اليوم — تُحسب بلا خصمٍ ولا إضافيّ
    const endMin = parseHHMM(t.shiftEnd);
    if (endMin != null) checkoutAt = new Date(bgMidnightUtc + endMin * 60 * 1000);
  } else if (parsed.data.mode === "custom") {
    // وقتُ الخروج **الفعليّ** كما يعرفه المدير — ويُحسب الخصمُ/الإضافيُّ منه بالضبط
    if (!parsed.data.at) return NextResponse.json({ error: "حدّد وقت الخروج" }, { status: 400 });
    const [hh, mm] = parsed.data.at.split(":").map(Number);
    let min = hh * 60 + mm;
    // خروجٌ بعد منتصف الليل (دوامٌ ليليّ): إن كان قبل الدخول فهو من اليوم التالي
    const inMin = Math.floor((rec.checkIn.getTime() - bgMidnightUtc) / 60000);
    if (min < inMin) min += 1440;
    checkoutAt = new Date(bgMidnightUtc + min * 60 * 1000);
  }
  if (checkoutAt.getTime() < rec.checkIn.getTime()) {
    return NextResponse.json({ error: "وقتُ الخروج قبل وقت الدخول" }, { status: 400 });
  }
  const calc = computeAttendance(t, rec.checkIn, checkoutAt, await approvedTimeLeaveFor(t.id, rec.dayKey));
  await prisma.attendance.update({ where: { id: rec.id }, data: { checkOut: checkoutAt, checkoutBy: "manager", ...calc } });
  return NextResponse.json({ ok: true, checkOut: checkoutAt, calc, corrected: rec.checkoutBy === "auto" });
}

// DELETE (المدير فقط): مسح بصمة يومٍ للفني إن كانت خاطئة (اليوم افتراضياً) — يستطيع الفني إعادة البصمة.
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const technicianId = Number(url.searchParams.get("technicianId"));
  const dayKey = url.searchParams.get("dayKey") || baghdadDayKey(new Date());
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  const t = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  const res = await prisma.attendance.deleteMany({ where: { technicianId, dayKey } });
  return NextResponse.json({ ok: true, deleted: res.count });
}
