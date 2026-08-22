import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ═════ 🔬 مسبارُ سجلّ المزامنة — قراءةٌ محضة (سؤالُ محمد 2026-08-22) ═════
//
// **العلّةُ التي يُصلحها**: نافذةُ السجلّ لا تعرض إلّا الصفوفَ **المعلَّقة**، فحين يسأل
// محمد «لماذا لم يظهر هذا المشترك؟» لا يوجد في البرنامج كلِّه مسارٌ يقرأ صفَّه المختومَ
// أو المتجاهَل — فيبقى الجوابُ ظنّاً. وقد وقعت الحالةُ فعلاً: أربعةُ مشتركين لهم تفعيلاتٌ
// خارجيّةٌ مؤكَّدةٌ في الساس ولا صفَّ لهم في أيّ تبويب، والحارسُ في `recordActivationEvent`
// يقول: «الحدثُ مسجَّلٌ **بأيّ حالة** ⇒ لا يتوالد» — أي أنّ صفَّهم موجودٌ بحالةٍ لا تُعرَض.
//
// يعرض هذا المسارُ **كلَّ** صفوف اليوزر (كلَّ الأنواع وكلَّ الحالات) بمن عالجها ومتى،
// ومعها حالةُ المشترك عندنا (تاريخُنا · رقمُ الساس · وصولاتُه) — فيُقرأ السببُ لا يُخمَّن.
// ✋ ولا يكتب شيئاً إطلاقاً: لا تعديلَ ولا حذفَ ولا نداءَ للساس.
// 🔒 والعزلُ بالمعرّفات: صفوفُ **مكاتب وكيل الجلسة** حصراً، وبصلاحيّة «مزامنة المكاتب».
const tableMissing = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";

export async function GET(req: Request) {
  const g = await guard("offices.sync");
  if (g.error) return g.error;
  const towers = await agentTowerIds(g.session ?? null);
  if (!towers.length) return NextResponse.json({ error: "لا مكاتبَ في حسابك" }, { status: 403 });

  const sp = new URL(req.url).searchParams;

  // ═════ 📏 قياسُ «ما أُغلق ولم يُصحَّح» — قبل تغيير سلوكٍ لا بعده ═════
  // صفوفُ أحداثٍ **مُغلَقة** (اعتُبرت معالَجةً) وتاريخُ الساس فيها ما زال يخالف تاريخَنا
  // ⇒ هؤلاء هم الذين سيعودون فرقَ أيّامٍ في «تحديث معلومات». يُقاس عددُهم قبل النشر
  // فلا تُفاجَأ النافذةُ بدفعةٍ مجهولة. قراءةٌ محضة.
  if (sp.get("stale") === "1") {
    try {
      const rows = await prisma.syncLog.findMany({
        where: {
          towerId: { in: towers }, kind: { in: ["sas", "self", "install"] },
          status: { not: "pending" }, activatedAt: { not: null }, sasDateTo: { not: null },
          subscriberId: { not: null },
        },
        orderBy: { id: "desc" }, take: 800,
        select: { id: true, towerId: true, kind: true, status: true, netUser: true, subscriberId: true, sasDateTo: true, activatedAt: true, handledBy: true, handledAt: true },
      });
      const ids = [...new Set(rows.map((r) => r.subscriberId!).filter(Boolean))];
      const subs = ids.length
        ? await prisma.subscriber.findMany({ where: { id: { in: ids }, isDeleted: false }, select: { id: true, dateTo: true, netUser: true } })
        : [];
      const byId = new Map(subs.map((s) => [s.id, s]));
      const TOL = 12 * 3600_000;
      const gain: Record<string, unknown>[] = [];
      const loss: Record<string, unknown>[] = [];
      const seen = new Set<number>();
      for (const r of rows) {
        const s = r.subscriberId != null ? byId.get(r.subscriberId) : undefined;
        if (!s?.dateTo || !r.sasDateTo) continue;
        if (seen.has(s.id)) continue; // أحدثُ صفٍّ لكلّ مشترك يكفي
        const diff = r.sasDateTo.getTime() - s.dateTo.getTime();
        if (Math.abs(diff) <= TOL) continue;
        seen.add(s.id);
        const row = {
          netUser: s.netUser, tower: r.towerId, kind: r.kind, status: r.status,
          عندنا: s.dateTo, الساس: r.sasDateTo, أيّام: Math.round(diff / 86400000),
          أغلقها: r.handledBy, وقت: r.handledAt,
        };
        (diff > 0 ? gain : loss).push(row);
      }
      const byTower = (list: Record<string, unknown>[]) => list.reduce((m: Record<string, number>, x) => { const k = String(x.tower); m[k] = (m[k] ?? 0) + 1; return m; }, {});
      return NextResponse.json({
        فُحص: rows.length,
        الساس_أحدث_من_تاريخنا: { عدد: gain.length, حسب_المكتب: byTower(gain), عيّنة: gain.slice(0, 15) },
        تاريخنا_أحدث_من_الساس: { عدد: loss.length, حسب_المكتب: byTower(loss), عيّنة: loss.slice(0, 8) },
      });
    } catch (e) {
      if (tableMissing(e)) return NextResponse.json({ dormant: true });
      throw e;
    }
  }

  const user = (sp.get("user") ?? "").trim();
  const sasId = Number(sp.get("sasId")) || null;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 40, 1), 200);
  if (!user && !sasId) return NextResponse.json({ error: "مرّر user أو sasId" }, { status: 400 });

  // صفُّ المشترك عندنا (للسياق: تاريخُنا مقابل تاريخ الساس، وهل هو مربوط)
  const sub = user
    ? await prisma.subscriber.findFirst({
        where: { netUser: { equals: user, mode: "insensitive" }, towerId: { in: towers }, isDeleted: false },
        select: { id: true, name: true, netUser: true, sasId: true, towerId: true, dateTo: true, packageId: true, carry: true },
      })
    : await prisma.subscriber.findFirst({
        where: { sasId: sasId ?? -1, towerId: { in: towers }, isDeleted: false },
        select: { id: true, name: true, netUser: true, sasId: true, towerId: true, dateTo: true, packageId: true, carry: true },
      });

  try {
    const rows = await prisma.syncLog.findMany({
      where: {
        towerId: { in: towers },
        OR: [
          ...(user ? [{ netUser: { equals: user, mode: "insensitive" as const } }] : []),
          ...(sasId ? [{ sasId }] : []),
          ...(sub?.sasId ? [{ sasId: sub.sasId }] : []),
          ...(sub ? [{ subscriberId: sub.id }] : []),
        ],
      },
      orderBy: { id: "desc" },
      take: limit,
      select: {
        id: true, kind: true, status: true, towerId: true, sasId: true, netUser: true, name: true,
        amount: true, activatedAt: true, sasDateTo: true, note: true, changes: true,
        handledBy: true, handledAt: true, createdAt: true, updatedAt: true,
      },
    });

    // وصولاتُ المشترك (لقاعدتَي «مقبوضٌ عندي» و«الكارتُ يُقاس بالوصل»)
    const receipts = sub
      ? await prisma.subscriptionEntry.findMany({
          where: { subscriberId: sub.id, isDeleted: false },
          orderBy: { id: "desc" }, take: 10,
          select: { id: true, date: true, dateTo: true, money: true, moneyIn: true, month: true },
        })
      : [];

    return NextResponse.json({
      سُئل: user || `sasId=${sasId}`,
      المشترك: sub
        ? { id: sub.id, name: sub.name, netUser: sub.netUser, sasId: sub.sasId, towerId: sub.towerId, dateTo: sub.dateTo, packageId: sub.packageId, carry: sub.carry }
        : "غيرُ موجودٍ في مكاتبك",
      عددُ_الصفوف: rows.length,
      الصفوف: rows.map((r) => ({
        id: r.id, kind: r.kind, status: r.status, towerId: r.towerId, sasId: r.sasId,
        netUser: r.netUser, amount: r.amount,
        activatedAt: r.activatedAt, sasDateTo: r.sasDateTo,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        handledBy: r.handledBy, handledAt: r.handledAt,
        note: r.note,
        changes: r.changes ? String(r.changes).slice(0, 300) : null,
      })),
      وصولاته: receipts,
    });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ dormant: true, الصفوف: [] });
    throw e;
  }
}
