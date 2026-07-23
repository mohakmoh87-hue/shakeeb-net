import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// أداة استرجاع طارئة (للمالك فقط): تتراجع عن «إرجاع كروت التفعيل الوهمي للمخزن»
// الذي نفّذته المزامنة خطأً. تعتمد سجل التدقيق (SYNC_PHANTOM_CARD) لتحديد الكروت،
// وتستعيد بياناتها الأصلية (وقت الاستخدام/المشترك/المستخدم) من وصل التفعيل المطابق
// لسيريال الكارت — فالاسترجاع دقيق دون تخمين.
// الاستدعاء: GET (معاينة فقط) — GET ?apply=1 (تنفيذ الاسترجاع). ?hours=48 نافذة البحث.
export async function GET(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;

  const url = new URL(request.url);
  const apply = url.searchParams.get("apply") === "1";
  const hours = Math.min(240, Math.max(1, Number(url.searchParams.get("hours")) || 48));
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const audits = await prisma.auditLog.findMany({
    where: { action: "SYNC_PHANTOM_CARD", createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
  });

  const seen = new Set<number>();
  const restorable: { cardId: number; serial: string | null; subscriber: string | null; useDate: string; by: string | null }[] = [];
  const skippedUsed: number[] = [];
  const unmatched: { cardId: number; serial: string | null; reason: string }[] = [];
  let restored = 0;

  for (const a of audits) {
    const cardId = Number(a.entityId);
    if (!Number.isFinite(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);

    const card = await prisma.rechargeCard.findUnique({
      select: { id: true, serial: true, useDate: true, subscriberId: true },
      where: { id: cardId },
    });
    if (!card) { unmatched.push({ cardId, serial: null, reason: "الكارت غير موجود" }); continue; }
    // استُخدم من جديد بعد الإرجاع (سحبه مكتب لمشترك آخر) — لا نلمسه، يُراجَع يدوياً
    if (card.useDate) { skippedUsed.push(cardId); continue; }

    const serial = (card.serial ?? "").trim();
    if (!serial) { unmatched.push({ cardId, serial: card.serial, reason: "بلا سيريال — تعذّرت مطابقة الوصل" }); continue; }

    // وصل التفعيل الأصلي: أحدث وصل بهذا السيريال قبل لحظة الإرجاع الخاطئ
    const entry = await prisma.subscriptionEntry.findFirst({
      where: { card2: serial, isDeleted: false, subscriberId: { not: null }, date: { lte: a.createdAt } },
      orderBy: { date: "desc" },
      select: { subscriberId: true, date: true, createdByUser: true },
    });
    if (!entry?.subscriberId) {
      unmatched.push({ cardId, serial, reason: "لا وصل تفعيل مطابق للسيريال — يُراجَع يدوياً" });
      continue;
    }

    const sub = await prisma.subscriber.findUnique({ where: { id: entry.subscriberId }, select: { name: true, netUser: true } });
    const useDate = entry.date ?? a.createdAt;
    restorable.push({
      cardId, serial, subscriber: sub?.name ?? sub?.netUser ?? String(entry.subscriberId),
      useDate: useDate.toISOString(), by: entry.createdByUser ?? null,
    });

    if (apply) {
      await prisma.rechargeCard.update({
        where: { id: cardId },
        data: { useDate, subscriberId: entry.subscriberId, userName: entry.createdByUser ?? "استرجاع" },
      });
      restored++;
    }
  }

  if (apply && restored > 0) {
    await prisma.auditLog.create({
      data: {
        action: "REPAIR_PHANTOM_ROLLBACK", entity: "rechargeCard",
        details: `استرجاع ${restored} كارت أُرجعت للمخزن خطأً بمزامنة «التفعيل الوهمي» (نافذة ${hours} ساعة)`,
      },
    });
  }

  return NextResponse.json({
    mode: apply ? "نُفِّذ الاسترجاع" : "معاينة فقط — أضف ?apply=1 للتنفيذ",
    auditRows: audits.length,
    cards: seen.size,
    restorable: restorable.length,
    restored,
    skippedUsedAgain: skippedUsed,
    unmatched,
    details: restorable,
  });
}
