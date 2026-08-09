import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, resolveCardActor } from "@/lib/field";

// تنسيق وقت بغداد للعرض في سجل التغييرات (dd/MM HH:mm)
const fmtBg = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const dynamic = "force-dynamic";

// تأجيل بطاقة (المشترك غير متواجد) — يجب تحديد موعد، وتعود البطاقة للانتظار لحين الموعد.
// الفاعل: مستخدم المكتب/المدير، أو الفني نفسه على بطاقته المسندة إليه (بعزل صارم).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.cardId);
  const postponeTo = b?.postponeTo ? new Date(b.postponeTo) : null;
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });
  if (!postponeTo || isNaN(postponeTo.getTime())) {
    return NextResponse.json({ error: "حدّد موعد التأجيل (تاريخ ووقت)" }, { status: 400 });
  }

  // ⚠️ المصادقة **قبل** أيّ قراءةٍ للبطاقة (اصطاده تدقيق 2026-08-09): كانت الردود تتمايز قبلها
  // (٤٠٤/٤٠٠/٤٠٣) فتكشف لمجهولٍ وجود بطاقةٍ برقمٍ ما وحالتها بمجرّد تجريب أرقام.
  const auth = await resolveCardActor(cardId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة" }, { status: 400 });
  // ===== بطاقة أودو: التأجيل = ملاحظة في أودو (الربط الثلاثيّ: إنجاز=close · إلغاء=cancel · تأجيل=ملاحظة) =====
  // فبلا ملاحظةٍ لا شيء يُبلَّغ لأودو، والتذكرة تبقى بلا حركة فتقع غرامة سوبر سيل. لذا الملاحظة
  // إلزاميّة هنا كما في الإلغاء، وتُحفَظ في سجلّ البطاقة ليدفعها العامل نصّاً كما كتبها الفنيّ.
  const note = String(b?.note ?? "").trim();
  if (card.viaOdoo && !note) {
    return NextResponse.json({ error: "اكتب ملاحظة التأجيل — تُرسَل إلى أودو" }, { status: 400 });
  }
  // شرط «بدء» قبل التأجيل يخص الفني على غير التوصيل فقط — بطاقة التوصيل بلا «بدء»
  // أصلاً (قاعدتها الثابتة — نفس قاعدة الإنجاز والإلغاء)، والمكتب/المدير بلا قيد
  const type = await prisma.cardType.findFirst({ where: { name: card.kind, isDeleted: false, agentId: auth.actor.agentId ?? -1 } });
  const isDelivery = type?.deliveryOnly ?? card.kind === "توصيل";
  if (!card.startedAt && !isDelivery && auth.actor.isTech) {
    return NextResponse.json({ error: "ابدأ البطاقة أولاً قبل التأجيل" }, { status: 400 });
  }

  // يُلغى وقت البدء (المدة لا تُحتسب على التأجيل) ويُسجَّل الموعد الجديد
  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: {
      startedAt: null, postponedTo: postponeTo,
      // بطاقة أودو: الملاحظة في عمودٍ صريح بطابعها ⇒ يدفعها العامل كما كتبها الفنيّ (ولو بأسطر)،
      // وكلّ تأجيلٍ لاحق يُدفَع لأنّ الطابع يصير أحدث من طابع الدفع.
      ...(card.viaOdoo && note ? { postponeNote: note.slice(0, 2000), postponeNoteAt: new Date() } : {}),
    },
  });
  // سجل التغييرات داخل البطاقة: من أجّل وإلى متى (والملاحظة بعد «—» يقرؤها دافعُ أودو)
  await appendCardHistory(cardId, auth.actor.name, `تأجيل البطاقة إلى ${fmtBg(postponeTo)}${note ? ` — ${note}` : ""}`);
  return NextResponse.json(updated);
}
