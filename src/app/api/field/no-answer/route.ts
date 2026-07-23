import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, resolveCardActor, listOfficeId } from "@/lib/field";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { getEffectiveTemplate } from "@/lib/smsTemplates";

export const dynamic = "force-dynamic";

// «ميجاوب»: الفني اتصل بالمشترك ولم يجب — البطاقة تبقى في مكانها كما هي،
// وتُرسل رسالة واتساب لطيفة للمشترك (قالب noAnswer القابل للتخصيص)، ويُحرَّر
// قفل «البدء» (يستطيع الفني بدء بطاقة أخرى بعدها).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.cardId);
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة" }, { status: 400 });
  const auth = await resolveCardActor(cardId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const actor = auth.actor;

  const towerId = await listOfficeId(card.listId);
  const office = towerId ? await prisma.tower.findUnique({ where: { id: towerId }, select: { name: true, waEnabled: true, agentId: true } }) : null;

  // مشترك البطاقة: يوزر صريح بعد «اليوزر:» ثم مطابقة كلمات النص مع netUser (ضمن مكتب البطاقة)
  const text = `${card.title}\n${card.description ?? ""}`;
  const explicit = text.match(/اليوزر\s*[:：]\s*([^\n]+)/)?.[1]?.trim();
  const where = towerId != null ? { towerId } : {};
  let sub = explicit && explicit !== "—"
    ? await prisma.subscriber.findFirst({ where: { isDeleted: false, netUser: { equals: explicit, mode: "insensitive" }, ...where }, select: { id: true, name: true, phone: true, waEnabled: true } })
    : null;
  if (!sub) {
    const words = [...new Set(text.split(/[\s،,\n]+/).map((w) => w.trim()).filter((w) => w.length >= 3))];
    if (words.length) sub = await prisma.subscriber.findFirst({ where: { isDeleted: false, netUser: { in: words, mode: "insensitive" }, ...where }, select: { id: true, name: true, phone: true, waEnabled: true } });
  }

  // تحرير قفل البدء + توثيق المحاولة في سجل البطاقة (تبقى بمكانها)
  await prisma.taskCard.update({ where: { id: cardId }, data: { startedAt: null } });
  await appendCardHistory(cardId, actor.name, "📵 ميجاوب — اتصل ولم يجب المشترك");

  // الرسالة (أفضل جهد): تتطلب مشتركاً بهاتف وواتساب مفعّلاً له وللمكتب وقالباً مفعّلاً
  let messaged = false;
  if (sub?.phone && sub.waEnabled !== false && office?.waEnabled !== "0") {
    const tpl = await getEffectiveTemplate("noAnswer", office?.agentId ?? actor.agentId ?? null, towerId);
    if (tpl) {
      const msg = renderTemplate(tpl, {
        name: sub.name, kind: card.kind, technician: actor.name, office: office?.name ?? "SHAKEEB",
      });
      const res = await sendViaProvider("WHATSAPP", sub.phone, msg, towerId).catch(() => ({ ok: false as const, error: "تعذّر الإرسال" }));
      messaged = res.ok;
      await prisma.message.create({
        data: {
          channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text: msg,
          status: res.ok ? "SENT" : "FAILED", error: ("error" in res ? res.error : null) ?? null,
          createdByUser: actor.name,
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, messaged, subscriberFound: !!sub });
}
