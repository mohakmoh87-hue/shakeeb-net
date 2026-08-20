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

export type InfoChange = { f: "phone" | "name" | "address" | "package" | "dateTo"; label: string; old: string; new: string };

const tableMissing = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";

function fingerprint(p: { name?: string | null; phone?: string | null; address?: string | null; packageName?: string | null; sasDateTo?: Date | null }): string {
  return JSON.stringify([p.name ?? "", p.phone ?? "", p.address ?? "", p.packageName ?? "", p.sasDateTo ? p.sasDateTo.toISOString().slice(0, 10) : ""]);
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
    const rows = await prisma.syncLog.findMany({
      where: { towerId: p.towerId, sasId: p.sasId, kind },
      orderBy: { id: "desc" }, take: 5,
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

/** حدثُ تفعيلٍ (تبويب ٣ ذاتيّ · تبويب ٤ صفحة بلا وصل) — صفٌّ لكلّ تفعيلة */
export async function recordActivationEvent(kind: "self" | "sas", p: StatePayload & { subscriberId: number; amount: number; activatedAt: Date }): Promise<void> {
  try {
    const dayStart = new Date(p.activatedAt); dayStart.setHours(dayStart.getHours() - 12);
    const dayEnd = new Date(p.activatedAt); dayEnd.setHours(dayEnd.getHours() + 12);
    const existing = await prisma.syncLog.findFirst({
      where: { towerId: p.towerId, sasId: p.sasId, kind, activatedAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true },
    });
    if (existing) return; // الحدثُ مسجَّلٌ (بأيّ حالة) — لا يتوالد مع كلّ دورة
    await prisma.syncLog.create({
      data: {
        agentId: p.agentId, towerId: p.towerId, kind, sasId: p.sasId, subscriberId: p.subscriberId,
        netUser: p.netUser ?? null, name: p.name ?? null, phone: p.phone ?? null,
        packageName: p.packageName ?? null, sasDateTo: p.sasDateTo ?? null,
        amount: p.amount, activatedAt: p.activatedAt,
      },
    });
  } catch (e) {
    if (!tableMissing(e)) console.error("[sync-log] تعذّر تسجيل حدث تفعيل:", e instanceof Error ? e.message : e);
  }
}

/** وصلٌ ظهر لاحقاً لنفس يوم الحدث (سجّله المستخدم يدويّاً) ⇒ يُختَم الحدثُ من نفسه */
export async function resolveEventIfReceipted(towerId: number, sasId: number, receiptAt: Date): Promise<void> {
  try {
    const dayStart = new Date(receiptAt); dayStart.setHours(dayStart.getHours() - 12);
    const dayEnd = new Date(receiptAt); dayEnd.setHours(dayEnd.getHours() + 12);
    await prisma.syncLog.updateMany({
      where: { towerId, sasId, kind: "sas", status: "pending", activatedAt: { gte: dayStart, lte: dayEnd } },
      data: { status: "done", note: "سُجّل وصلٌ يدويّاً لنفس اليوم", handledAt: new Date() },
    });
  } catch { /* خامد */ }
}

/** هل المنجرُ كابينةُ مشتركٍ (تفعيلٌ ذاتيّ)؟ قاعدة محمد: FDT<مقطع اليوزر الأوّل>-<لاحقة@> */
export function isCabinetManager(manager: string | null | undefined): boolean {
  return /^FDT/i.test((manager ?? "").trim());
}

/** هل باقةُ الساس «باقةَ عرض»؟ (علامةُ التنصيب/الإعادة في تصنيف محمد) */
export function isOfferPackage(pkgName: string | null | undefined): boolean {
  return /offer/i.test((pkgName ?? "").trim());
}
