import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { inspectPendingDeletedCards } from "@/lib/cardDeleteGuard";

// ═════════ 🛡️ حارسُ المال · الحالاتُ **وإجراءاتُها** (طلبُ محمد 2026-08-14) ═════════
//
// «علاجُ الحالات الشاذّة يكون في **نفس الحارس** وليس مثلَ الآن فقط تجاهُل — فيوفّر
//  حارسُ المال إجراءاتٍ يمكن اتّخاذها منه مباشرةً.»
//
// فلكلّ حكمٍ إجراءٌ يُنفَّذ من الصفحة نفسِها:
//   • `restore-stock`   — يُعيد الكارتَ **للمخزن** كما كان (بلا مشترك) — لحالة `unsold`
//   • `restore-linked`  — يُعيده **مستخدَماً ومربوطاً بمشتركه** — لحالة الحذف الظالم (٧٤)
//   • `fix-duration`    — يُصحّح مدّةَ التفعيل بعددِ أيّامٍ يُدخله المدير (لا تُخمَّن)
//   • `recheck`         — يُعيد الفحصَ في الساس (لحالة `unverified`/`error`)
//   • `resolved`        — «عُولجت» بملاحظةٍ إلزاميّة — تسجيلُ قرارٍ لا طمسُ حالة
//
// 🔒 والعزلُ في **شرطِ كلّ استعلامٍ وكلّ تحديث** لا في فحصٍ سابقٍ عليه.

export async function GET(request: Request) {
  const g = await guard("cards.delete");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "open"; // open | all | handled

  const where: Record<string, unknown> = { agentId };
  if (view === "open") {
    // الحالاتُ التي تنتظر قراراً: كلُّ غيرِ الطبيعيّ وغيرِ المُعالَج
    where.verdict = { notIn: ["normal"] };
    where.handledAt = null;
  } else if (view === "handled") {
    where.handledAt = { not: null };
  }

  const rows = await prisma.deletedCardLog.findMany({
    where, orderBy: { id: "desc" }, take: 400,
    select: {
      id: true, serial: true, price: true, packageId: true, useDate: true, subscriberId: true,
      deletedAt: true, deletedBy: true, reason: true, verdict: true, verdictAt: true,
      sasInfo: true, handledAction: true, handledAt: true, handledBy: true, handledNote: true,
      restoredCardId: true, towerId: true,
    },
  });

  // أسماءُ المشتركين والمكاتب دفعةً — بمعرّفاتِ الصفوف الظاهرةِ وحدَها
  const subIds = [...new Set(rows.map((r) => r.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true } })
    : [];
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const towerIds = [...new Set(rows.map((r) => r.towerId).filter((x): x is number => x != null))];
  const towers = towerIds.length
    ? await prisma.tower.findMany({ where: { id: { in: towerIds }, agentId }, select: { id: true, name: true } })
    : [];
  const towerMap = new Map(towers.map((t) => [t.id, t.name]));

  // عدّادُ ما ينتظر قراراً — للشارةِ على الزرّ
  const openCount = await prisma.deletedCardLog.count({
    where: { agentId, verdict: { notIn: ["normal", "pending"] }, handledAt: null },
  });
  const pendingCount = await prisma.deletedCardLog.count({ where: { agentId, verdict: "pending" } });

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      subName: r.subscriberId != null ? (subMap.get(r.subscriberId)?.name ?? null) : null,
      subUser: r.subscriberId != null ? (subMap.get(r.subscriberId)?.netUser ?? null) : null,
      office: r.towerId != null ? (towerMap.get(r.towerId) ?? null) : null,
    })),
    openCount, pendingCount,
  });
}

export async function POST(request: Request) {
  const g = await guard("cards.delete");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const by = g.session?.fullName ?? g.session?.username ?? null;

  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id) || 0;
  const action = String(body?.action ?? "");
  const note = String(body?.note ?? "").trim();
  const days = Number(body?.days) || 0;
  if (!id) return NextResponse.json({ error: "لا صفَّ محدَّد" }, { status: 400 });

  // 🔒 العزل: الصفُّ من وكيلِ الجلسة أو لا شيء
  const row = await prisma.deletedCardLog.findFirst({ where: { id, agentId } });
  if (!row) return NextResponse.json({ error: "الحالةُ غيرُ موجودةٍ ضمن حسابك" }, { status: 404 });

  // ═══ إعادةُ الفحص: يُرجَع الحكمُ إلى pending ثمّ يُفحَص فوراً ═══
  if (action === "recheck") {
    await prisma.deletedCardLog.updateMany({
      where: { id, agentId }, data: { verdict: "pending", verdictAt: null, sasInfo: null },
    });
    const res = await inspectPendingDeletedCards(1);
    const after = await prisma.deletedCardLog.findFirst({ where: { id, agentId }, select: { verdict: true, sasInfo: true } });
    return NextResponse.json({ ok: true, verdict: after?.verdict, sasInfo: after?.sasInfo, checked: res.checked });
  }

  // ═══ الاستعادة: يُعاد بناءُ صفِّ الكارت من اللقطة ═══
  if (action === "restore-stock" || action === "restore-linked") {
    if (!row.serial) return NextResponse.json({ error: "لا سيريالَ في اللقطة — لا سبيلَ للاستعادة" }, { status: 400 });
    // ⚠️ وقيدُ `@@unique([agentId, serial])` يمنع التكرار — لكنّ الرسالةَ الواضحةَ أفضلُ من خطأِ قاعدة
    const clash = await prisma.rechargeCard.findFirst({
      where: { agentId, serial: row.serial }, select: { id: true, useDate: true },
    });
    if (clash) {
      await prisma.deletedCardLog.updateMany({
        where: { id, agentId, handledAt: null },
        data: {
          handledAction: "resolved", handledAt: new Date(), handledBy: by,
          handledNote: `الكارتُ موجودٌ سلفاً في المخزن (#${clash.id}) — لا حاجةَ للاستعادة`,
          restoredCardId: clash.id,
        },
      });
      return NextResponse.json({ ok: true, already: true, cardId: clash.id });
    }
    const linked = action === "restore-linked";
    // ═════ اللقطةُ بلا مشترك؟ يُستخرَج من **يوزر الساس** (بلاغ محمد 2026-08-14) ═════
    // «لو ضغطتُ ربط من الحارس يبلّغني: اللقطةُ بلا مشترك — تصلح إعادةٌ للمخزن فقط. ولكن
    //  إذا أرجعتُه للمخزن فلن يمكن تفعيلُه مرّةً أخرى وستلتقطه المزامنة.» — وهو محقّ:
    // الكارتُ مستهلَكٌ في الساس، فإرجاعُه مخزوناً **يصنع كارتاً وهميّاً**. والساسُ يُخبرنا
    // باليوزر داخل `sasInfo`، ومنه يُعرَف المشترك — فيُربَط به كما يفعل زرُّ «ربط» في
    // الكروت الوهميّة تماماً. 🔒 والعزل: المشتركُ من مكاتب هذا الوكيل حصراً.
    let linkSubId = row.subscriberId;
    if (linked && linkSubId == null) {
      const uname = row.sasInfo?.match(/الساس:\s*([^\s·]+)/)?.[1]?.trim() ?? "";
      if (uname) {
        const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
        const sub = towers.length
          ? await prisma.subscriber.findFirst({
              where: { netUser: uname, isDeleted: false, towerId: { in: towers.map((t) => t.id) } },
              select: { id: true },
            })
          : null;
        if (sub) linkSubId = sub.id;
      }
      if (linkSubId == null) {
        return NextResponse.json({
          error: "اللقطةُ بلا مشترك ولا يوزرَ يُستدلّ به من الساس — تصلح «إعادةٌ للمخزن» فقط",
        }, { status: 400 });
      }
    }
    const created = await prisma.rechargeCard.create({
      data: {
        agentId, serial: row.serial, number: row.number, password: row.password,
        packageId: row.packageId, price: row.price,
        // ⚠️ يُستردّ تاريخُ الإدخال الأصليّ لا تاريخُ اليوم — وإلّا انتقل الكارتُ لوجبةٍ أخرى
        addDate: row.addDate,
        userName: row.userName,
        // مربوطاً: تاريخُ الاستخدام من اللقطة، وإن غاب (كارتٌ استُهلك في الساس والبرنامجُ
        // يحسبه مخزوناً) فوقتُ الاستعادة — فالمهمّ ألّا يعود «متاحاً» فتلتقطه المزامنة وهميّاً.
        ...(linked ? { useDate: row.useDate ?? new Date(), subscriberId: linkSubId } : {}),
      },
      select: { id: true },
    });
    // الحَجزُ قبل الأثر: لا يُعالَج صفٌّ مرّتَين فيُنشأ كارتان
    const claimed = await prisma.deletedCardLog.updateMany({
      where: { id, agentId, handledAt: null },
      data: {
        handledAction: action, handledAt: new Date(), handledBy: by,
        handledNote: note || (linked ? "أُعيد مستخدَماً ومربوطاً بمشتركه" : "أُعيد للمخزن"),
        restoredCardId: created.id,
      },
    });
    // ═════ قاعدةُ محمد (2026-08-14): «الاستعادةُ لا تُغيّر ديونَ الكارتات» ═════
    // ديونُ الكارتات = مجموعُ أسعار صفوف الكروت + المعاوضات. وحذفُ **الوهمية** يُبقي الدينَ
    // بمعاوضةِ إضافةٍ («ديون الكارتات لم تنقص») — فإذا استُعيد الكارتُ عاد سعرُه للمجموع
    // **وبقيت المعاوضةُ** ⇒ يُعَدُّ مرّتَين (حادثةُ محمد: +٤٤٬٦٥٠ عند الربط). فتُكتب هنا
    // معاوضةُ إنقاصٍ مضادّةٌ — **فقط حين كان الحذفُ من الوهمية** (`reason=phantom`). أمّا
    // حذفُ المخزن العاديّ فقد أنقص الدينَ فعلاً، فاستعادتُه تُرجعه — صفرٌ صافٍ بلا معاوضة.
    // وبهذا: دورةُ (حذف ← استعادة) **صفريّةُ الأثر على الديون في كلّ الطرق** — وهو عينُ
    // القاعدة. وشرطُ `claimed === 1` يمنع معاوضةً مزدوجةً عند ضغطتَين متسابقتَين.
    if (claimed.count === 1 && (row.price ?? 0) > 0 && row.reason === "phantom") {
      await prisma.managerTx.create({
        data: {
          type: "card-debt-sub", amount: row.price!, agentId, managerId: null,
          userId: g.session?.userId, byUser: by,
          notes: `⚖️ معاوضة استعادة كارت ${row.serial} من الحارس — الاستعادة لا تضيف ديون كارتات`,
        },
      }).catch(() => {}); // فشلُ المعاوضة لا يُبطل الاستعادةَ — ويظهر فرقُها في الديون فيُصحَّح يدويّاً
    }
    await prisma.auditLog.create({
      data: {
        userId: g.session?.userId, action: "CARD_GUARD_RESTORE", entity: "rechargeCard",
        entityId: String(created.id),
        details: `حارسُ المال: استعادةُ ${row.serial} (${action}) بسعر ${row.price ?? 0}` +
                 `${linked ? ` · مربوطٌ بالمشترك ${linkSubId}${row.subscriberId == null ? " (استُدلَّ عليه من يوزر الساس)" : ""}` : ""} · الحكمُ كان ${row.verdict}`,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, cardId: created.id, claimed: claimed.count });
  }

  // ═══ تصحيحُ المدّة: بعددِ أيّامٍ **يُدخله المدير** — لا يُخمَّن ═══
  if (action === "fix-duration") {
    if (!(days > 0 && days <= 400)) {
      return NextResponse.json({ error: "أدخل عددَ أيّامٍ بين ١ و٤٠٠" }, { status: 400 });
    }
    if (row.subscriberId == null) return NextResponse.json({ error: "لا مشتركَ في اللقطة" }, { status: 400 });
    // 🔒 المشتركُ من مكاتبِ هذا الوكيل — وإلّا فتصحيحٌ عابرٌ للوكلاء
    const towers = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
    const sub = await prisma.subscriber.findFirst({
      where: { id: row.subscriberId, towerId: { in: towers.map((t) => t.id) } }, select: { id: true, dateTo: true },
    });
    if (!sub) return NextResponse.json({ error: "المشتركُ ليس ضمن مكاتبك" }, { status: 404 });
    const entry = await prisma.subscriptionEntry.findFirst({
      where: { subscriberId: sub.id, isDeleted: false, dateFrom: { not: null } },
      orderBy: { id: "desc" }, select: { id: true, dateFrom: true, dateTo: true },
    });
    if (!entry?.dateFrom) return NextResponse.json({ error: "لا قيدَ تفعيلٍ لتصحيحه" }, { status: 404 });
    const newTo = new Date(entry.dateFrom.getTime() + days * 86400_000);
    await prisma.subscriptionEntry.update({ where: { id: entry.id }, data: { dateTo: newTo } });
    // متوسّط(٣٠) · النسختان كانتا تفترقان: يُصحَّح تاريخُ الوصل ويبقى تاريخُ المشترك الحيُّ
    // القديمَ (وعليه تعمل المزامنةُ والتذكيراتُ والتقارير). إن كان تاريخُ المشترك مأخوذاً
    // من هذا الوصل بعينه (يطابق قيمتَه القديمة) صُحّح معه — وإلّا فلا يُمَسّ.
    if (sub.dateTo != null && entry.dateTo != null && sub.dateTo.getTime() === entry.dateTo.getTime()) {
      await prisma.subscriber.update({ where: { id: sub.id }, data: { dateTo: newTo } });
    }
    await prisma.deletedCardLog.updateMany({
      where: { id, agentId, handledAt: null },
      data: {
        handledAction: "fix-duration", handledAt: new Date(), handledBy: by,
        handledNote: note || `صُحّحت المدّةُ إلى ${days} يوماً (قيد #${entry.id})`,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: g.session?.userId, action: "CARD_GUARD_FIX_DURATION", entity: "subscriptionEntry",
        entityId: String(entry.id),
        details: `حارسُ المال: مدّةُ التفعيل ${entry.dateTo?.toISOString() ?? "—"} ⇒ ${newTo.toISOString()} (${days} يوماً)`,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, entryId: entry.id, dateTo: newTo });
  }

  // ═══ «عُولجت»: قرارٌ يُسجَّل بملاحظةٍ إلزاميّة — لا زرَّ تجاهُلٍ أعمى ═══
  if (action === "resolved") {
    if (!note) return NextResponse.json({ error: "الملاحظةُ إلزاميّة — القرارُ يُسجَّل بسببه" }, { status: 400 });
    const claimed = await prisma.deletedCardLog.updateMany({
      where: { id, agentId, handledAt: null },
      data: { handledAction: "resolved", handledAt: new Date(), handledBy: by, handledNote: note },
    });
    return NextResponse.json({ ok: true, claimed: claimed.count });
  }

  return NextResponse.json({ error: "إجراءٌ غيرُ معروف" }, { status: 400 });
}
