import { prisma } from "./prisma";

// ═════ 📋 محرّك سجلّ المزامنة (2026-08-20) ═════
// تكتبه المزامنةُ أثناء مرورها القائم (صفرُ نداءاتِ ساسٍ إضافيّة — قرار محمد في س٢)،
// وتقرؤه نافذةُ «سجلّ المزامنة» فوريّاً من القاعدة.
// صنفان من الصفوف:
//   · صفوف حالة (info · install): صفٌّ حيٌّ واحدٌ لكلّ (نوع، مكتب، sasId). التجاهلُ يخزّن
//     «بصمةَ» قيم الساس لحظتَه — فإن تغيّرت لاحقاً ظهر صفُّ **info** جديدٌ (قرار محمد ج٣:
//     المتجاهَلُ تنصيبُه لا يعود تنصيباً؛ يعود «تحديثَ معلومات» وتحديثُه يستورده كاملاً بلا وصل).
//   · صفوف حدث (self · sas): صفٌّ لكلّ تفعيلةٍ (sasId + وقتُها). تجاهلُه نهائيٌّ لذلك الحدث،
//     وتفعيلةٌ جديدةٌ لاحقاً صفٌّ جديدٌ بطبيعتها.
// ⚠️ كلُّ الدوالّ «أفضلُ جهدٍ» ولا تُفشل المزامنةَ أبداً — وغيابُ الجدول (P2021 قبل لصق
// محمد الـSQL) صمتٌ تامّ فالميزةُ خامدةٌ حتى التهيئة.

// 🔴 netUser أخطرُها (تغيّرُ اليوزر في الساس — بلاغ محمد 2026-08-21) ويُعرَض بالأحمر
// danger: تغييرٌ تطبيقُه يُتلف بياناتٍ (نقصُ أيّامٍ يتجاوز أسبوعاً) — الواجهةُ تُبرزه وتستثنيه من «تحديد الكلّ»
// 🔗 sasLink: رقمُ الساس تغيّر ليوزرٍ قائم (أعادت الشركةُ إنشاءَ الحساب) — تطبيقُه **ربطٌ**
//    لا استبدال. وكان هذا يُرصَد «تنصيباً خارجيّاً»، و«تحديث» عليه يؤرشف صفَّك ويُنشئ ثانياً.
export type InfoChange = { f: "phone" | "name" | "address" | "package" | "dateTo" | "netUser" | "sasLink"; label: string; old: string; new: string; danger?: boolean };

const tableMissing = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";

// 🔴 اليوزرُ **داخلَ البصمة** (مراجعة 2026-08-21): كان خارجَها، فصفٌّ تُجوهل ثمّ غيّرت
// الشركةُ يوزرَه لا تتغيّر بصمتُه ⇒ يبقى مدفوناً — وهو أخطرُ تغييرٍ على الإطلاق.
// ⚠️ **مصدَّرةٌ عمداً**: كان للـAPI نسخةٌ ثانيةٌ منها بخمسة حقولٍ بينما هذه بستّة (أُضيف
// اليوزر 2026-08-21) ⇒ البصمتان لا تتطابقان أبداً ⇒ **كلُّ صفٍّ تُجاهله يعود في أوّل
// مزامنة** (بلاغُ محمد). فصارت الدالّةُ واحدةً لا نسختَين.
export function fingerprint(p: { netUser?: string | null; name?: string | null; phone?: string | null; address?: string | null; packageName?: string | null; sasDateTo?: Date | null }): string {
  return JSON.stringify([(p.netUser ?? "").toLowerCase(), p.name ?? "", p.phone ?? "", p.address ?? "", p.packageName ?? "", p.sasDateTo ? p.sasDateTo.toISOString().slice(0, 10) : ""]);
}

type StatePayload = {
  agentId: number; towerId: number; sasId: number;
  subscriberId?: number | null; netUser?: string | null; name?: string | null;
  phone?: string | null; address?: string | null; packageName?: string | null; sasDateTo?: Date | null;
};

/** صفُّ حالةٍ (info/install): يُحدَّث الحيُّ، ويُحترم المتجاهَلُ ما لم تتغيّر بصمتُه.
 *  يرجع true حين يستحقّ الصفُّ **رسالةً تلقائيّة** (طلب محمد 2026-08-20): رُصد لأوّل
 *  مرّةٍ وله هاتف، أو كان معلّقاً بلا هاتفٍ فوصل هاتفُه الآن (رصدُ المرحلة ١ بلا هاتفٍ
 *  ثمّ تُكمله المرحلة ٢ به — فبلا هذا الشرط لا تُرسَل رسالةُ التنصيب أبداً لهؤلاء). */
async function upsertStateRow(kind: "info" | "install", p: StatePayload, changes: InfoChange[] | null): Promise<boolean> {
  try {
    const fp = fingerprint(p);
    const data = {
      agentId: p.agentId, towerId: p.towerId, sasId: p.sasId,
      subscriberId: p.subscriberId ?? null, netUser: p.netUser ?? null, name: p.name ?? null,
      phone: p.phone ?? null, address: p.address ?? null, packageName: p.packageName ?? null,
      sasDateTo: p.sasDateTo ?? null,
      changes: changes ? JSON.stringify(changes) : null,
    };
    // 🔴 **صفوفُ الحالة وحدَها** (مراجعة 2026-08-21): تفعيلاتُ الشركة تُخزَّن أيضاً بـ
    // `kind:"install"` لكنّها **مؤرَّخة** (`activatedAt`)، وكان البحثُ يأخذ آخرَ خمسة صفوفٍ
    // أيّاً كانت ⇒ خمسُ تفعيلاتِ شركةٍ تحجب صفَّ الحالة فيُنشأ صفٌّ جديدٌ كلَّ مزامنة،
    // وربّما كُتبت بياناتُ حالةٍ **فوق** صفّ حدثٍ فاختلط النوعان. الآن: غيرُ المؤرَّخة
    // فقط، وبلا سقفٍ يحجب (المعلَّقُ والمتجاهَلُ واحدٌ لكلّ حالةٍ بطبيعتها).
    const rows = await prisma.syncLog.findMany({
      where: { towerId: p.towerId, sasId: p.sasId, kind, activatedAt: null, status: { in: ["pending", "ignored"] } },
      orderBy: { id: "desc" }, take: 10,
      select: { id: true, status: true, snapshot: true, phone: true },
    });
    const pending = rows.find((r) => r.status === "pending");
    if (pending) {
      await prisma.syncLog.update({ where: { id: pending.id }, data });
      return !(pending.phone ?? "").trim() && !!(p.phone ?? "").trim();
    }
    const ignored = rows.find((r) => r.status === "ignored");
    if (ignored) {
      if (ignored.snapshot === fp) return false; // لم يتغيّر شيءٌ منذ تجاهله — يبقى صامتاً
      // تغيّرت بياناتُه بعد التجاهل ⇒ يظهر «تحديثَ معلومات» فقط (قرار محمد ج٣)
      if (kind === "install") {
        const infoOpen = await prisma.syncLog.findFirst({
          where: { towerId: p.towerId, sasId: p.sasId, kind: "info", status: "pending" }, select: { id: true },
        });
        const diffs: InfoChange[] = [{ f: "name", label: "بيانات الساس تغيّرت بعد تجاهل تنصيبه", old: "(متجاهَل)", new: p.name ?? p.netUser ?? "" }];
        if (infoOpen) await prisma.syncLog.update({ where: { id: infoOpen.id }, data: { ...data, changes: JSON.stringify(diffs) } });
        else await prisma.syncLog.create({ data: { ...data, kind: "info", changes: JSON.stringify(diffs) } });
        // وتُحدَّث بصمةُ التجاهل كي لا يتوالد صفُّ info مع كلّ دورة
        await prisma.syncLog.update({ where: { id: ignored.id }, data: { snapshot: fp } });
        return false;
      }
      // info متجاهَل وتغيّرت القيم ⇒ يُفتح من جديد بالتغييرات الجديدة
      await prisma.syncLog.update({ where: { id: ignored.id }, data: { ...data, status: "pending", snapshot: null } });
      return false;
    }
    await prisma.syncLog.create({ data: { ...data, kind } });
    return !!(p.phone ?? "").trim(); // رُصد لأوّل مرّةٍ — رسالةٌ إن كان له هاتف
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر تسجيل صفّ حالة:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** تغيّرُ بياناتِ مشتركٍ قائم (تبويب ١) */
export async function recordInfoDiff(p: StatePayload & { subscriberId: number }, changes: InfoChange[]): Promise<void> {
  if (!changes.length) {
    // لا فرقَ الآن ⇒ صفٌّ معلّقٌ قديمٌ لهذا المشترك صار بلا موضوع (طُبّق يدويّاً مثلاً) — يُختَم
    try {
      await prisma.syncLog.updateMany({
        where: { towerId: p.towerId, sasId: p.sasId, kind: "info", status: "pending" },
        data: { status: "done", note: "تطابقت البيانات (عُدّلت يدويّاً أو من الساس)", handledAt: new Date() },
      });
    } catch { /* خامد */ }
    return;
  }
  await upsertStateRow("info", p, changes);
}

/** تنصيبٌ/إعادةُ شركةٍ (تبويب ٢) — subscriberId فارغٌ للجديد غير المحفوظ.
 *  يرجع true إن استحقّ الرصدُ رسالةَ «تنصيبات خارجية» التلقائيّة (أوّلُ ظهورٍ بهاتف). */
export async function recordInstall(p: StatePayload): Promise<boolean> {
  return upsertStateRow("install", p, null);
}

/** وسمُ القرض في `note` — تقرؤه الواجهةُ والخادمُ فيمنعان صناعةَ وصلِ بيعٍ له */
export const LOAN_NOTE = "💸 قرض (مبلغ صفر بلا كارت)";

/** 🏢 تفعيلُ الشركة/الديلر لمشتركٍ قائم = «إعادةُ خدمة» (تصنيف محمد ٦-ب) ⇒ تبويب «تنصيب
 *  خارجي» حدثاً **مؤرَّخاً**. وكان هذا النوعُ يسقط في الفراغ فلا يظهر في أيّ تبويب:
 *  المنجرُ ليس صفحةَ المكتب ولا كابينةَ صاحب اليوزر، فلا «تفعيلات ساس» ولا «تفعيل خارجي».
 *  ⚠️ وكونُه مؤرَّخاً (activatedAt) يستثنيه من التصحيح الذاتيّ للتنصيبات — فلا يُغلَق
 *     بعد يومٍ لمجرّد أنّ تفعيلتَه خرجت من النافذة؛ يُغلقه الوصلُ أو قرارُك وحدَهما. */
export async function recordCompanyActivation(
  p: StatePayload & { subscriberId: number; amount: number; activatedAt: Date; loan?: boolean; managerName?: string | null; oldSasDateTo?: Date | null },
): Promise<EventOutcome> {
  try {
    const from = new Date(p.activatedAt.getTime() - 30 * 60_000);
    const to = new Date(p.activatedAt.getTime() + 30 * 60_000);
    const existing = await prisma.syncLog.findFirst({
      where: { towerId: p.towerId, sasId: p.sasId, kind: "install", activatedAt: { gte: from, lte: to } },
      select: { id: true, status: true },
    });
    // كسابقتها: الحالةُ تُقال — فصفٌّ مُغلَقٌ لا بيتَ للواقعة فيه ولا يُسكِت فرقَ الأيّام
    if (existing) return existing.status === "pending" ? "open" : "closed";
    await prisma.syncLog.create({
      data: {
        agentId: p.agentId, towerId: p.towerId, kind: "install", sasId: p.sasId, subscriberId: p.subscriberId,
        netUser: p.netUser ?? null, name: p.name ?? null, phone: p.phone ?? null,
        packageName: p.packageName ?? null, sasDateTo: p.sasDateTo ?? null,
        amount: p.amount, activatedAt: p.activatedAt,
        oldSasDateTo: p.oldSasDateTo ?? null, // 📈 لمدّة التفعيل بالأشهر (أرباحُ الشركة)
        note: p.loan ? LOAN_NOTE : `🏢 تفعيلُ شركة/ديلر${p.managerName ? ` — ${p.managerName}` : ""}`,
      },
    });
    return "created";
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر تسجيل تفعيل شركة:", e instanceof Error ? e.message : e);
    return "open"; // تعذّرَ التسجيلُ ⇒ لا يُفتَح بابٌ ثانٍ بالخطأ
  }
}

// ═════ 🎴💰 «كلُّ حالةٍ لا بيتَ لها ⇒ بيتُها حارسُ المال» (إملاءُ محمد 2026-08-21) ═════
// حالةُ «جاسم محمد طلال علوان عيساوي»: فُعِّل بثلاثة كروتٍ **كلُّها من خارج المخزن**،
// فحُسب «تفعيلاً خارجيّاً» و«تفعيلاً مكرَّراً» — ثمّ **لم يُخزَّن في أيّ مكان**: لا في سجلّ
// المزامنة ولا في حارس المال، بل ذُكر في تقرير مزامنةٍ عابرٍ ثمّ ضاع.
// ونصُّ محمد: «أيُّ حالةٍ في المزامنة ليس لها مكانٌ تُخزَّن فيه فيجب أن تكون في حارس المال،
// وتُدقَّق من كلّ النواحي: هل له وصل؟ بكم؟ هل هو ديلر؟ — وتُذكَر التفاصيلُ والتقييم».
// 🔑 وقاعدتُه في التقييم: **ديلرُ الثلاثة أشهرٍ يُفعَّل دائماً بكروتٍ خارج المخزن**،
//    ووصلُه = مبلغُ ثلاثة أشهرٍ **ناقص خمسة آلاف** ⇒ حالةٌ بسيطةٌ غيرُ ضارّةٍ إطلاقاً.
// يُخزَّن بـ`kind:"card"` — نوعٌ **لا تعرضه نافذةُ سجلّ المزامنة** (تبويباتُها أربعةٌ ثابتة)،
// فلا يُزاحم عملَ المستخدم اليوميّ، ويقرؤه حارسُ المال بتفاصيله وتقييمه.
export type ExtCardVerdict = "dealer" | "receipted" | "no-receipt" | "stolen";
export async function recordExternalCardCase(p: {
  agentId: number; towerId: number; sasId: number; subscriberId: number | null;
  netUser: string | null; name: string | null; activatedAt: Date;
  pins: string[]; amount: number; verdict: ExtCardVerdict; detail: string;
}): Promise<void> {
  try {
    const from = new Date(p.activatedAt.getTime() - 12 * 3600_000);
    const to = new Date(p.activatedAt.getTime() + 12 * 3600_000);
    const existing = await prisma.syncLog.findFirst({
      where: { towerId: p.towerId, sasId: p.sasId, kind: "card", activatedAt: { gte: from, lte: to } },
      select: { id: true },
    });
    const data = {
      agentId: p.agentId, towerId: p.towerId, kind: "card", sasId: p.sasId,
      subscriberId: p.subscriberId, netUser: p.netUser ?? null, name: p.name ?? null,
      amount: Math.round(p.amount || 0), activatedAt: p.activatedAt,
      note: p.detail,
      changes: JSON.stringify({ verdict: p.verdict, pins: p.pins }),
    };
    if (existing) await prisma.syncLog.update({ where: { id: existing.id }, data });
    else await prisma.syncLog.create({ data });
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر تسجيل حالة كارتٍ خارجيّ:", e instanceof Error ? e.message : e);
  }
}

// ═════ 🔴🎴 كارتٌ **من المخزن** فُعِّل بلا وصل — «مسروق» (إملاءُ محمد 2026-08-22) ═════
// نصُّه: «إذا اليوزرُ لم يُفعَّل له وصلٌ في البرنامج فهذا الكارتُ **مسروقٌ من المخزن**».
// يُخزَّن بنفس نوع الكروت (`card`) فيقرؤه حارسُ المال — لكن بحكمٍ مستقلٍّ `stolen` وعنوانٍ
// وخطورةٍ خاصّةٍ به هناك. ويُميَّز بمفتاح **السيريال** لا بالمشترك وحدَه: الكارتُ هو الواقعة.
// ⚠️ ولا يتحرّك مالٌ: بلاغٌ لا قيد. والإغلاقُ الذاتيُّ في `reconcileStolenCards` أدناه.
export async function recordStolenCardCase(p: {
  agentId: number; towerId: number; sasId: number; subscriberId: number | null;
  netUser: string | null; name: string | null; activatedAt: Date;
  pins: string[]; amount: number; detail: string;
}): Promise<void> {
  try {
    const serial = (p.pins[0] ?? "").trim();
    // منعُ التكرار بالسيريال نفسِه (قراءةُ التفعيلة تتكرّر كلَّ دورة)
    const existing = await prisma.syncLog.findFirst({
      where: { towerId: p.towerId, kind: "card", changes: { contains: `"stolenSerial":"${serial}"` } },
      select: { id: true, status: true },
    });
    const data = {
      agentId: p.agentId, towerId: p.towerId, kind: "card", sasId: p.sasId,
      subscriberId: p.subscriberId, netUser: p.netUser ?? null, name: p.name ?? null,
      amount: Math.round(p.amount || 0), activatedAt: p.activatedAt,
      note: p.detail,
      changes: JSON.stringify({ verdict: "stolen", pins: p.pins, stolenSerial: serial }),
    };
    if (existing) {
      // صفٌّ عولج (تُجوهل) لا يُبعَث من جديد — قرارُ المدير يُحترَم
      if (existing.status !== "pending") return;
      await prisma.syncLog.update({ where: { id: existing.id }, data });
    } else {
      await prisma.syncLog.create({ data });
    }
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر تسجيل حالة كارتٍ مسروق:", e instanceof Error ? e.message : e);
  }
}

/**
 * ♻️ الإغلاقُ الذاتيُّ لحالات السرقة: متى ظهر وصلٌ لصاحب الكارت (±٣ أيّامٍ من التفعيل)
 * تُغلَق الحالةُ وحدَها بلا ضغطةٍ من أحد — وهو شرطُ محمد في كلّ رصدٍ تلقائيّ.
 */
export async function reconcileStolenCards(
  towerId: number,
  hasReceipt: (netUser: string, subscriberId: number | null, actAt: Date) => Promise<boolean>,
): Promise<number> {
  try {
    const rows = await prisma.syncLog.findMany({
      where: { towerId, kind: "card", status: "pending", activatedAt: { not: null } },
      select: { id: true, netUser: true, subscriberId: true, activatedAt: true, changes: true },
      take: 300,
    });
    const closing: number[] = [];
    for (const r of rows) {
      let verdict = "";
      try { verdict = String((JSON.parse(r.changes ?? "{}") as { verdict?: string }).verdict ?? ""); } catch { /* نصٌّ غيرُ مقروء */ }
      if (verdict !== "stolen" || !r.activatedAt) continue;
      if (await hasReceipt((r.netUser ?? "").trim().toLowerCase(), r.subscriberId, r.activatedAt)) closing.push(r.id);
    }
    if (!closing.length) return 0;
    await prisma.syncLog.updateMany({
      where: { id: { in: closing } },
      data: { status: "done", note: "أُغلق تلقائيّاً: ظهر وصلٌ لصاحب الكارت في نافذة ٣ أيّام" },
    });
    return closing.length;
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر التصحيحُ الذاتيُّ لحالات السرقة:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * نتيجةُ تسجيل حدث: أُنشئ الآن · موجودٌ **معلَّق** · موجودٌ **مُغلَق**.
 * 🔑 ولماذا يهمّ التمييز؟ لأنّ صفّاً مُغلَقاً («اعتُبر معالَجاً») **لا بيتَ للواقعة فيه**:
 *    فلو أسكتنا فرقَ الأيّام بحجّة «بيتُها تبويبُ التفعيل» لضاع الفرقُ إلى الأبد — وهو
 *    ما وقع فعلاً (ثلاثةُ مشتركين تأخّرت تواريخُهم ٢٤ و٣١ و٣٤ يوماً وهم فعّالون).
 */
export type EventOutcome = "created" | "open" | "closed";

/** حدثُ تفعيلٍ (تبويب ٣ ذاتيّ · تبويب ٤ صفحة بلا وصل) — صفٌّ لكلّ تفعيلة */
export async function recordActivationEvent(kind: "self" | "sas", p: StatePayload & { subscriberId: number; amount: number; activatedAt: Date; loan?: boolean; oldSasDateTo?: Date | null }): Promise<EventOutcome> {
  try {
    // ⏱️ **دقّةُ منع التكرار ±٣٠ دقيقة لا ±١٢ ساعة** (مراجعة 2026-08-21): النافذةُ الواسعة
    // كانت تبتلع **الحدثَ الثاني في اليوم نفسِه** — وهي حالةٌ في تصنيف محمد (نوع ٢: ديلر
    // ثمّ برنامج). وإعادةُ قراءةِ التفعيلة نفسِها تحمل وقتَها نفسَه فيبقى المنعُ محكماً.
    const dayStart = new Date(p.activatedAt.getTime() - 30 * 60_000);
    const dayEnd = new Date(p.activatedAt.getTime() + 30 * 60_000);
    const existing = await prisma.syncLog.findFirst({
      where: { towerId: p.towerId, sasId: p.sasId, kind, activatedAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, status: true },
    });
    // الحدثُ مسجَّلٌ ⇒ لا يتوالد مع كلّ دورة، لكن **تُقال حالتُه** ليُعرَف أله بيتٌ أم لا
    if (existing) return existing.status === "pending" ? "open" : "closed";
    await prisma.syncLog.create({
      data: {
        agentId: p.agentId, towerId: p.towerId, kind, sasId: p.sasId, subscriberId: p.subscriberId,
        netUser: p.netUser ?? null, name: p.name ?? null, phone: p.phone ?? null,
        packageName: p.packageName ?? null, sasDateTo: p.sasDateTo ?? null,
        amount: p.amount, activatedAt: p.activatedAt,
        // 📈 الانتهاءُ قبل التفعيلة — تقرؤه «أرباحُ الشركة» لتعرف المدّةَ بالأشهر يقيناً
        oldSasDateTo: p.oldSasDateTo ?? null,
        // 💸 **القرضُ ليس تفعيلاً خارجيّاً** (بلاغُ محمد 2026-08-21: bg-1-14-2@mu): سعرُ صفرٍ
        //    يعني قرضاً من سوبر سيل، ولا فعلَ عليه إطلاقاً (لا وصلَ ولا دين — يُسدَّد
        //    بتفعيلٍ عاديٍّ لاحقاً). فيُسجَّل **مختوماً** لا معلَّقاً: أثرٌ يُقرأ في السجلّ
        //    ولا يُزاحم عملاً حقيقيّاً في التبويب.
        ...(p.loan ? { note: LOAN_NOTE, status: "done", handledAt: new Date() } : {}),
      },
    });
    return "created";
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر تسجيل حدث تفعيل:", e instanceof Error ? e.message : e);
    return "open"; // تعذّرَ التسجيلُ ⇒ لا يُفتَح بابٌ ثانٍ بالخطأ
  }
}

/** وصلٌ ظهر لاحقاً لنفس يوم الحدث (سجّله المستخدم يدويّاً) ⇒ يُختَم الحدثُ من نفسه.
 *  يشمل **النوعَين** (تفعيلات ساس · تفعيل خارجي) — فالوصلُ يُغلق البابَين (قرار محمد 2026-08-21). */
export async function resolveEventIfReceipted(towerId: number, sasId: number, receiptAt: Date): Promise<void> {
  try {
    const dayStart = new Date(receiptAt); dayStart.setHours(dayStart.getHours() - 12);
    const dayEnd = new Date(receiptAt); dayEnd.setHours(dayEnd.getHours() + 12);
    await prisma.syncLog.updateMany({
      where: { towerId, sasId, kind: { in: ["sas", "self", "install"] }, status: "pending", activatedAt: { gte: dayStart, lte: dayEnd } },
      data: { status: "done", note: "سُجّل وصلٌ يدويّاً لنفس اليوم", handledAt: new Date() },
    });
  } catch { /* خامد */ }
}

// ═════ ♻️ السجلُّ تفاعليٌّ: يُصحّح نفسَه في كلّ مزامنة (شرط محمد 2026-08-21) ═════
// نصُّه: «إذا وجد أنّ شيئاً أُصلح في المزامنة التالية يحدّث نفسه معها ويُبقي ما تبقّى».
// ثلاثةُ أبواب للإغلاق الذاتيّ، وكلُّها **مشروطةٌ بأنّنا رأينا الحالةَ فعلاً** في هذه
// الدورة (`seenSasIds`) — فمكتبٌ تعذّرت قراءتُه أو لوحةٌ لم تُمسح لا يُغلق لها صفٌّ بالظنّ:
//   ١· تنصيبٌ معلّقٌ لم يعد مؤهَّلاً (استُورد صاحبُه · أو زالت القاعدةُ التي ولّدته).
//   ٢· تحديثُ معلوماتٍ لم يبقَ فيه فرق ⇒ يُغلقه `recordInfoDiff` أصلاً بلا فرق.
//   ٣· حدثُ تفعيلٍ ظهر له وصلٌ لاحقاً ⇒ يُغلقه `resolveEventIfReceipted`.
/** 💰 صفوفُ أحداثٍ معلَّقةٌ صار لها وصلٌ عندنا ⇒ تُغلَق — **مهما قدُم تفعيلُها**.
 *  (بلاغُ محمد 2026-08-21: bg-59-31-2@shu — وصلُ ١٠٠ ألفٍ لثلاثة أشهر وتفعيلةُ ساسٍ
 *  بشهرٍ واحد؛ وكان الصفُّ يخرج من نافذة اليومَين فلا يُعاد النظرُ فيه أبداً فيبقى
 *  معلَّقاً للأبد.) الفحصُ هنا **بالقاعدة نفسِها** التي تعمل بها المزامنة: وصلٌ قريبٌ من
 *  التفعيل أو وصلٌ ينتهي بانتهاء الساس — على مستوى **اليوزر** لا الصفّ. */
export async function reconcileEvents(
  towerId: number,
  collected: (netUser: string, subscriberId: number, actAt: Date | null, sasDateTo: Date | null) => Promise<boolean>,
): Promise<number> {
  try {
    const rows = await prisma.syncLog.findMany({
      where: { towerId, kind: { in: ["sas", "self", "install"] }, status: "pending", activatedAt: { not: null } },
      select: { id: true, netUser: true, subscriberId: true, activatedAt: true, sasDateTo: true },
      take: 500,
    });
    const closing: number[] = [];
    for (const r of rows) {
      if (r.subscriberId == null) continue; // تنصيبُ يوزرٍ لم يُستورَد بعد — لا وصلَ له أصلاً
      if (await collected((r.netUser ?? "").trim().toLowerCase(), r.subscriberId, r.activatedAt, r.sasDateTo)) closing.push(r.id);
    }
    if (!closing.length) return 0;
    await prisma.syncLog.updateMany({
      where: { id: { in: closing } },
      data: { status: "done", note: "وصلٌ عندنا يغطّيه — أُغلق تلقائيّاً", handledAt: new Date() },
    });
    return closing.length;
  } catch { return 0; }
}

export async function reconcileInstalls(towerId: number, seenSasIds: Set<number>, stillInstalls: Set<number>): Promise<number> {
  if (!seenSasIds.size) return 0; // لم نرَ شيئاً (مسحٌ فاشل) ⇒ لا نُغلق شيئاً بالظنّ
  try {
    const rows = await prisma.syncLog.findMany({
      where: { towerId, kind: "install", status: { in: ["pending", "ignored"] } },
      select: { id: true, sasId: true, activatedAt: true },
    });
    const stale = rows
      .filter((r) => r.sasId != null && r.activatedAt == null && seenSasIds.has(r.sasId) && !stillInstalls.has(r.sasId))
      .map((r) => r.id);
    if (!stale.length) return 0;
    await prisma.syncLog.updateMany({
      where: { id: { in: stale } },
      data: { status: "done", note: "عولج تلقائيّاً — لم يعد تنصيباً معلّقاً", handledAt: new Date() },
    });
    return stale.length;
  } catch { return 0; }
}

/** 🪦 رقمُ ساسٍ ماتَ (أعادت الشركةُ إنشاءَ الحساب برقمٍ جديد): صفوفُه المعلّقةُ لن تُرى
 *  في أيّ مزامنةٍ بعد اليوم — فلا يُغلقها التصحيحُ الذاتيّ (شرطُه الرؤية) وتبقى أبداً.
 *  تُغلَق هنا لحظةَ اكتشاف الرقم الجديد لليوزر نفسِه. */
export async function closeDeadSasRows(towerId: number, deadSasId: number | null, newSasId: number): Promise<void> {
  if (deadSasId == null || deadSasId === newSasId) return;
  try {
    await prisma.syncLog.updateMany({
      where: { towerId, sasId: deadSasId, status: { in: ["pending", "ignored"] } },
      data: { status: "done", note: `رقمُ الساس تغيّر إلى ${newSasId} — أُغلق تلقائيّاً`, handledAt: new Date() },
    });
  } catch { /* خامد */ }
}

/** صفوفُ معلوماتٍ معلّقةٌ لمشتركين لم نعد نراهم أو زال موضوعُها ⇒ تُغلق (نفس شرط الرؤية) */
export async function reconcileInfo(towerId: number, seenSasIds: Set<number>, stillDiffering: Set<number>): Promise<number> {
  if (!seenSasIds.size) return 0;
  try {
    const rows = await prisma.syncLog.findMany({
      where: { towerId, kind: "info", status: "pending" },
      select: { id: true, sasId: true },
    });
    const stale = rows
      .filter((r) => r.sasId != null && seenSasIds.has(r.sasId) && !stillDiffering.has(r.sasId))
      .map((r) => r.id);
    if (!stale.length) return 0;
    await prisma.syncLog.updateMany({
      where: { id: { in: stale } },
      data: { status: "done", note: "تطابقت البيانات — عولج تلقائيّاً", handledAt: new Date() },
    });
    return stale.length;
  } catch { return 0; }
}

/** هل المنجرُ كابينةُ مشتركٍ (تفعيلٌ ذاتيّ)؟ قاعدة محمد: FDT<مقطع اليوزر الأوّل>-<لاحقة@> */
export function isCabinetManager(manager: string | null | undefined): boolean {
  return /^FDT/i.test((manager ?? "").trim());
}

/** كابينةُ يوزرٍ بعينه بقاعدة محمد: `bg-63-8-1@res` ⇒ `FDT63-RES` (FDT + أوّلِ مقطعٍ رقميٍّ + لاحقةِ @) */
export function cabinetOf(username: string | null | undefined): string | null {
  const u = (username ?? "").trim();
  const m = /^[^-\s]+-(\d+)[^@]*@([A-Za-z0-9]+)/.exec(u);
  return m ? `FDT${m[1]}-${m[2].toUpperCase()}` : null;
}

/** 🎯 المنجرُ كابينةُ **صاحب هذا اليوزر** لا أيَّ كابينةٍ (مراجعةُ 2026-08-21): «يبدأ بـFDT»
 *  وحدَها تَعُدُّ تفعيلَ كابينةٍ أخرى أو حسابٍ يبدأ بـFDT تفعيلاً ذاتيّاً — وهو خطأُ تصنيف.
 *  وحين يتعذّر اشتقاقُ الكابينة من اليوزر (صيغةٌ غريبة) نسقط إلى القاعدة القديمة. */
export function isOwnCabinet(username: string | null | undefined, manager: string | null | undefined): boolean {
  const mgr = (manager ?? "").trim();
  if (!mgr) return false;
  const cab = cabinetOf(username);
  if (!cab) return isCabinetManager(mgr);
  return mgr.toUpperCase() === cab;
}

/** هل باقةُ الساس «باقةَ عرض»؟ (علامةُ التنصيب/الإعادة في تصنيف محمد) */
export function isOfferPackage(pkgName: string | null | undefined): boolean {
  return /offer/i.test((pkgName ?? "").trim());
}
