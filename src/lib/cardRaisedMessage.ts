import { prisma } from "@/lib/prisma";
import { getEffectiveTemplateFull } from "@/lib/smsTemplates";
import { renderTemplate, sendViaProvider, imageNote } from "@/lib/messaging";

// ═════ البند ٧ · رسالةٌ للمشترك عند **رفعِ** بطاقةٍ له (طلبُ محمد 2026-08-13) ═════
// «الآن عند انتهاء الصيانة تصل رسالةٌ للمشترك... ولكن أريد أيضاً أن تصله رسالةٌ ولها
//  قالبٌ عند رفعِ بطاقةٍ له — سواءً من أودو أو من البرنامج».
//
// 🔴 **ومصيدةُ التكرار هي كلُّ الخطر**: أودو تُنشئ البطاقاتَ بمسحٍ شاملٍ **كلَّ دورة**،
//   و**تُعيد إنشاءَ بطاقةٍ حُذفت وتذكرتُها ما زالت مفتوحة**. فبلا ختمٍ تُرسَل الرسالةُ
//   للمشترك كلَّ دورةٍ إلى الأبد — وهي عينُ حادثة تكرار رسائل الشدن (٤ نسخٍ لكلّ مشترك).
// ⇒ `TaskCard.raisedNoticeAt` **يُختَم قبل الإرسال حَجزاً ذرّيّاً** (`updateMany` بشرط
//   `null`)، فمَن كسب الحجزَ وحدَه يُرسل. ولا يُفَكّ الختمُ عند الفشل: رسالةٌ لم تصل
//   أهونُ من رسالةٍ تصل كلَّ دقيقتَين — وسببُ الفشل يبقى في `messages`.

/** يُرسل رسالةَ «رُفعت لك بطاقة» مرّةً واحدةً أبداً لكلّ بطاقة. صامتٌ وغيرُ معطِّل. */
export async function sendCardRaisedMessage(cardId: number): Promise<void> {
  try {
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: {
        id: true, title: true, kind: true, label: true, subscriberId: true, officeId: true,
        raisedNoticeAt: true, listId: true, viaOdoo: true, odooPhone: true, description: true,
      },
    });
    if (!card || card.raisedNoticeAt != null) return;

    // ═════ بطاقةُ أودو: لا `subscriberId` لها بنيويّاً — هاتفُها في `odooPhone` ═════
    // (قياس 2026-08-14: كلُّ بطاقات أودو بلا مشترك ⇒ كانت الدالّةُ تخرج صامتةً لها دائماً،
    //  فذراعُ «أو من أودو» من طلب محمد لم يعمل قطّ. المشتركُ يُروى من وصف البطاقة إن وُجد.)
    if (card.subscriberId == null) {
      if (!card.viaOdoo || !card.odooPhone) return;
      // مجموعةُ اللوحة: مكتبُ البطاقة الماليّ (officeId) لا مكتبُ اللوحة الرئيسيّ — فبطاقةُ أودو
      // لمكتبٍ ثانويٍّ تستعمل اسمَه وواتسابَه وقالبَه. null ⇒ مكتبُ اللوحة (سلوكُ اليوم).
      const boardOffice = (await prisma.taskList.findUnique({ where: { id: card.listId }, select: { boardId: true } })
        .then((l) => l ? prisma.taskBoard.findUnique({ where: { id: l.boardId }, select: { towerId: true } }) : null))?.towerId ?? null;
      const officeId = card.officeId ?? boardOffice;
      if (officeId == null) return;
      const office = await prisma.tower.findUnique({
        where: { id: officeId },
        select: { name: true, agentId: true, waEnabled: true },
      });
      if (!office || office.waEnabled === "0") return;
      const tpl = await getEffectiveTemplateFull("cardRaised", office.agentId, officeId);
      if (!tpl) return;
      const claimed = await prisma.taskCard.updateMany({
        where: { id: card.id, raisedNoticeAt: null },
        data: { raisedNoticeAt: new Date() },
      });
      if (claimed.count !== 1) return;
      const desc = card.description ?? "";
      const text = renderTemplate(tpl.text, {
        "الاسم": desc.match(/🧑 المشترك: (.+)/)?.[1]?.trim() ?? "",
        "اليوزر": desc.match(/👤 اليوزر: (.+)/)?.[1]?.trim() ?? "",
        "العملية": card.label ?? card.kind ?? "تذكرة أودو",
        "التفاصيل": card.title ?? "",
        "المكتب": office.name ?? "SHAKEEB",
        "المصدر": "أودو",
      });
      const res = await sendViaProvider("WHATSAPP", card.odooPhone, text, officeId, tpl.image);
      await prisma.message.create({
        data: {
          channel: "WHATSAPP", phone: card.odooPhone, text,
          status: res.ok ? "SENT" : "FAILED", error: imageNote(res),
          createdByUser: "card-raised", agentId: office.agentId ?? null,
        },
      }).catch(() => {});
      return;
    }

    const sub = await prisma.subscriber.findUnique({
      where: { id: card.subscriberId },
      select: { id: true, name: true, netUser: true, phone: true, waEnabled: true, towerId: true },
    });
    if (!sub?.phone || sub.waEnabled === false || sub.towerId == null) return;

    const office = await prisma.tower.findUnique({
      where: { id: sub.towerId },
      select: { name: true, agentId: true, waEnabled: true },
    });
    if (!office || office.waEnabled === "0") return; // واتساب المكتب مطفأ

    const tpl = await getEffectiveTemplateFull("cardRaised", office.agentId, sub.towerId);
    if (!tpl) return; // القالب معطَّلٌ أو غائب ⇒ لا إرسالَ ولا ختم

    // 🔒 الحَجزُ **قبل** الأثر: مَن كسب `count === 1` وحدَه يُرسل. ولو أُرسل ثمّ خُتم
    //   لَأرسلت دورتان معاً في لحظةِ تزامن.
    const claimed = await prisma.taskCard.updateMany({
      where: { id: card.id, raisedNoticeAt: null },
      data: { raisedNoticeAt: new Date() },
    });
    if (claimed.count !== 1) return; // سبقنا غيرُنا

    const text = renderTemplate(tpl.text, {
      "الاسم": sub.name ?? "",
      "اليوزر": sub.netUser ?? "",
      "العملية": card.label ?? card.kind ?? "",
      "التفاصيل": card.title ?? "",
      "المكتب": office.name ?? "SHAKEEB",
      "المصدر": card.viaOdoo ? "أودو" : "المكتب",
    });
    const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId, tpl.image);
    await prisma.message.create({
      data: {
        channel: "WHATSAPP",
        subscriberId: sub.id,
        phone: sub.phone,
        text,
        status: res.ok ? "SENT" : "FAILED",
        error: res.error ?? null,
        createdByUser: "card-raised",
        agentId: office.agentId ?? null, // عزلُ سجلّ الرسائل بالوكيل — كانت تُكتب بلا وكيلٍ فتغيب عن سجلّه
      },
    }).catch(() => {});
  } catch {
    // صامتٌ تماماً: رفعُ البطاقة أهمُّ من رسالةٍ عنها، ولا يُفشِله فشلُ الإرسال
  }
}
