import { NextResponse } from "next/server";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

// قائمة آخر عمليات التفعيل مع أسماء المشتركين
export async function GET(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  // سقف 100 كان يخفي وصولات داخلة في المجاميع ولا يمكن بلوغها ولا حذفها، والبحث
  // كان يجري في المتصفح على المحمّل وحده فوصلٌ أقدم لا يُبحث عنه أبداً (تدقيق 2026-08-04).
  // الآن: بحث وتاريخ من الخادم + عدّ كامل + مجاميع على كل المطابق لا على المعروض.
  const sp = new URL(request.url).searchParams;
  const subId = sp.get("subscriberId");
  const q = (sp.get("q") ?? "").trim();
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  const withMeta = sp.get("meta") === "1";
  const take = Math.min(2000, Math.max(1, Number(sp.get("take")) || 500));

  const dateFilter: { gte?: Date; lte?: Date } = {};
  // ب-٨ · بدايةُ اليوم ونهايتُه **بتوقيت بغداد** لا بتوقيت الخادم (UTC)
  { const d = baghdadStart(fromStr); if (d) dateFilter.gte = d; }
  { const d = baghdadEnd(toStr); if (d) dateFilter.lte = d; }

  // البحث الحر: اسم المشترك أو يوزره، أو الفئة، أو رقم الوصل، أو المبلغ
  let qWhere: object = {};
  if (q) {
    const qNum = Number(q.replace(/[,،]/g, ""));
    const matchedSubs = await prisma.subscriber.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { netUser: { contains: q, mode: "insensitive" } }] },
      select: { id: true },
      take: 5000,
    });
    qWhere = {
      OR: [
        { cardType: { contains: q, mode: "insensitive" } },
        ...(matchedSubs.length ? [{ subscriberId: { in: matchedSubs.map((x) => x.id) } }] : []),
        ...(Number.isFinite(qNum) && qNum > 0 ? [{ id: qNum }, { money: qNum }, { moneyIn: qNum }] : []),
      ],
    };
  }

  const where = {
    isDeleted: false,
    ...(await towerScope(g.session)),
    ...(subId ? { subscriberId: Number(subId) } : {}),
    ...(dateFilter.gte || dateFilter.lte ? { date: dateFilter } : {}),
    ...(q ? qWhere : {}),
  };

  const entries = await prisma.subscriptionEntry.findMany({ where, orderBy: { id: "desc" }, take });

  const ids = [...new Set(entries.map((e) => e.subscriberId).filter(Boolean))];
  const subs = await prisma.subscriber.findMany({
    where: { id: { in: ids as number[] } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(subs.map((s) => [s.id, s.name]));

  const rows = entries.map((e) => ({
    ...e,
    subscriberName: e.subscriberId ? nameMap.get(e.subscriberId) : null,
  }));

  // meta=1: شكل موسّع للسجلات التي تحتاج العدّ والمجاميع الكاملة. وبدونها تبقى
  // الاستجابة مصفوفةً كما كانت — فلا تنكسر الشاشات التي تستهلكها اليوم.
  if (withMeta) {
    const [matched, agg] = await Promise.all([
      prisma.subscriptionEntry.count({ where }),
      prisma.subscriptionEntry.aggregate({ where, _sum: { money: true, moneyIn: true, addPrice: true } }),
    ]);
    return NextResponse.json({
      rows,
      matched,
      sums: {
        value: (agg._sum.money ?? 0) + (agg._sum.addPrice ?? 0),
        collected: agg._sum.moneyIn ?? 0,
      },
    });
  }

  return NextResponse.json(
    rows,
  );
}

// ═════ 🔴 عالٍ (أ) · مسارُ POST المُزال (المسحُ العدائيّ 2026-08-19) ═════
//
// كان هنا مسارُ تفعيلٍ **ثانٍ** موروثٌ (POST) يوازي مسارَ التفعيل الحيّ
// (subscribers/[id]/activate) — لكنّه ناقصُ المرايا كلِّها:
//   · يكتب قبضَ الصندوق **بلا sourceId** ⇒ الحذفُ العكسيّ للوصل لا يجد الحركةَ
//     فيبقى المالُ حيّاً في الصندوق لوصلٍ محذوف (والعكسُ: حذفُ الحركة يترك الوصل).
//   · لا يمنح المكافأةَ، ولا يمسح أختامَ التحويل/الانتهاء، ولا يمسح قرضَ الفزعة،
//     ويتجاهل نظامَ تفعيل المكتب (activationMode) في حساب التاريخ.
//
// 📏 وقياسُ الاستعمال قبل الإزالة (شرطُ محمد: لا يُمَسّ كودٌ فعّالٌ مستخدَم):
//    grep على المستودع كلِّه = **صفرُ مستدعين** لـPOST — الواجهةُ تستهلك GET وحدَه
//    (سجلُّ الوصولات). فالإزالةُ تُغلق بابَ خطرٍ ماليٍّ بلا مساسِ شيءٍ حيّ.
//    (نداءُ POST الآن يُجاب 405 من Next تلقائيّاً، وGET أعلاه كما هو حرفيّاً.)
//
// ولمن يحتاج التفعيلَ برمجيّاً: المسارُ الصحيح POST /api/subscribers/[id]/activate.
