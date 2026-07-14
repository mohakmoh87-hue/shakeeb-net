import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getOrCreatePettyAccount } from "@/lib/field";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// يحاول إيجاد مشترك من نصّ البطاقة (يوزر/هاتف) ضمن مكتب الفني.
async function matchSubscriber(text: string, towerId: number | null) {
  // 1) يوزر صريح بعد "اليوزر:"
  const userLine = text.match(/اليوزر\s*[:：]\s*([^\n]+)/);
  const explicit = userLine?.[1]?.trim();
  const where = towerId != null ? { towerId } : {};
  if (explicit && explicit !== "—") {
    const s = await prisma.subscriber.findFirst({
      where: { isDeleted: false, netUser: { equals: explicit, mode: "insensitive" }, ...where },
      select: { id: true, name: true, phone: true, netUser: true, towerId: true },
    });
    if (s) return s;
  }
  // 2) مطابقة أي كلمة في النص مع netUser للمشتركين
  const words = [...new Set(text.split(/[\s،,\n]+/).map((w) => w.trim()).filter((w) => w.length >= 3))];
  if (words.length === 0) return null;
  return prisma.subscriber.findFirst({
    where: { isDeleted: false, netUser: { in: words, mode: "insensitive" }, ...where },
    select: { id: true, name: true, phone: true, netUser: true, towerId: true },
  });
}

const schema = z.object({
  cardId: z.coerce.number().int().positive(),
  serviceDetails: z.string().optional(),
  amount: z.coerce.number().min(0).optional(),
  newUser: z.string().optional(), // اليوزر الجديد (إلزامي لبطاقة التحويل)
  photo: z.string().optional(), // data URL (JPEG مضغوط)
  materials: z
    .array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive() }))
    .optional()
    .default([]),
});

// إنجاز بطاقة — بحقولها الواجبة حسب النوع:
//  • صيانة: تفاصيل + مبلغ + صورة (المواد اختيارية).
//  • توصيل: مبلغ فقط.
// منطق المواد: تُباع من المخزن (تُضاف للمبيعات)، وتُخصم من ذمّة الفني. والمبلغ يُقسَّم:
// جزء بقيمة المواد المباعة (مبيعات)، والباقي مقبوض في حساب "نثرية". وإن كان المبلغ
// أقل من قيمة المواد فكامله يُسجَّل للمبيعات فقط.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { cardId, serviceDetails, amount, newUser, photo, materials } = parsed.data;

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة مسبقاً" }, { status: 400 });
  if (card.technicianId == null) {
    return NextResponse.json({ error: "يجب توجيه البطاقة لفني قبل إنجازها" }, { status: 400 });
  }
  if (!card.startedAt) {
    return NextResponse.json({ error: "اضغط «بدء» قبل إنجاز البطاقة" }, { status: 400 });
  }
  // مدة الإنجاز = من وقت البدء حتى الآن
  const durationSec = Math.max(0, Math.round((Date.now() - card.startedAt.getTime()) / 1000));

  // نوع البطاقة: توصيل (مبلغ فقط) / تحويل (يوزر جديد إلزامي) / صيانة وغيرها (حقول كاملة)
  const type = await prisma.cardType.findFirst({ where: { name: card.kind, isDeleted: false } });
  const isDelivery = type?.deliveryOnly ?? card.kind === "توصيل";
  const isTransfer = card.kind === "تحويل";

  // التحقّق من الحقول الواجبة
  if (amount == null || amount <= 0) {
    return NextResponse.json({ error: "المبلغ مطلوب" }, { status: 400 });
  }
  if (isTransfer) {
    if (!newUser?.trim()) return NextResponse.json({ error: "اليوزر الجديد مطلوب لإنجاز التحويل" }, { status: 400 });
  } else if (!isDelivery) {
    if (!serviceDetails?.trim()) return NextResponse.json({ error: "تفاصيل الصيانة مطلوبة" }, { status: 400 });
    if (!photo?.trim()) return NextResponse.json({ error: "رفع صورة مطلوب" }, { status: 400 });
  }

  // مكتب الفني (لعزل المبيعات/النثرية)
  const tech = await prisma.technician.findUnique({ where: { id: card.technicianId } });
  const towerId = tech?.towerId ?? null;

  // ===== معالجة المواد (للصيانة فقط؛ التوصيل بلا مواد) =====
  const soldInfo: { itemId: number; name: string; qty: number; price: number }[] = [];
  let materialsTotal = 0;
  if (!isDelivery && materials.length > 0) {
    for (const m of materials) {
      const item = await prisma.item.findFirst({ where: { id: m.itemId, isDeleted: false } });
      if (!item) return NextResponse.json({ error: `مادة #${m.itemId} غير موجودة` }, { status: 404 });
      const custody = await prisma.custody.findFirst({
        where: { technicianId: card.technicianId, itemId: m.itemId, isDeleted: false },
      });
      if (!custody || custody.qty < m.qty) {
        return NextResponse.json({ error: `الكمية بذمّة الفني من «${item.name}» غير كافية` }, { status: 400 });
      }
      const price = item.priceSale ?? 0;
      materialsTotal += price * m.qty;
      soldInfo.push({ itemId: item.id, name: item.name ?? "مادة", qty: m.qty, price });
    }
  }

  // تقسيم المبلغ: ما يخصّ المواد (مبيعات) والباقي (نثرية)
  const salesShare = materials.length > 0 ? Math.min(amount, materialsTotal) : 0;
  const pettyShare = amount - salesShare; // الباقي (قد يكون كامل المبلغ إن لا مواد)

  const petty = pettyShare > 0 ? await getOrCreatePettyAccount(towerId) : null;

  await prisma.$transaction(async (tx) => {
    // خصم المواد من المخزن ومن ذمّة الفني
    for (const s of soldInfo) {
      const item = await tx.item.findUnique({ where: { id: s.itemId } });
      await tx.item.update({ where: { id: s.itemId }, data: { count: (item?.count ?? 0) - s.qty } });
      const custody = await tx.custody.findFirst({
        where: { technicianId: card.technicianId!, itemId: s.itemId, isDeleted: false },
      });
      if (custody) await tx.custody.update({ where: { id: custody.id }, data: { qty: custody.qty - s.qty } });
    }
    // قيد المبيعات (حصّة المواد)
    if (salesShare > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: salesShare, moneyOut: 0, date: new Date(), serverDate: new Date(),
          userId: session.userId, sourceType: "sale", sourceId: cardId, towerId,
          notes: `مبيع ذمم — تكت #${cardId}: ` + soldInfo.map((s) => `${s.name}×${s.qty}`).join("، "),
        },
      });
    }
    // قيد النثرية (الباقي)
    if (petty && pettyShare > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: pettyShare, moneyOut: 0, date: new Date(), serverDate: new Date(),
          userId: session.userId, accountId: petty.id, sourceType: "manual", towerId,
          notes: `نثرية — ${isDelivery ? "توصيل" : "صيانة"} تكت #${cardId}`,
        },
      });
    }
    // حفظ الصورة (تُحذف مع البطاقة/التحصيل)
    if (photo?.trim()) {
      await tx.cardPhoto.upsert({
        where: { cardId }, update: { data: photo }, create: { cardId, data: photo },
      });
    }
    // إنجاز البطاقة (تبقى معلّقة حتى التحصيل)
    await tx.taskCard.update({
      where: { id: cardId },
      data: {
        done: true, completedAt: new Date(), durationSec,
        amount, serviceDetails: serviceDetails?.trim() || null,
        materialsInfo: soldInfo.length ? JSON.stringify(soldInfo) : null,
      },
    });
  });

  // ===== ما بعد الإنجاز (لا يُفشل الإنجاز إن تعثّر): مطابقة المشترك، سجل الصيانات، رسالة واتساب =====
  let matchedSubscriber: number | null = null;
  let messaged = false;
  try {
    const cardText = `${card.title}\n${card.description ?? ""}`;
    const sub = await matchSubscriber(cardText, towerId);
    if (sub) {
      matchedSubscriber = sub.id;
      // تحويل: تحديث يوزر المشترك لليوزر الجديد + تسجيله بسجل الصيانات
      if (isTransfer && newUser?.trim()) {
        const nu = newUser.trim();
        // تحديث اليوزر + وسم التحويل (يُنبَّه عند التفعيل ويُحذف بعد 30 يوماً دون تفعيل)
        await prisma.subscriber.update({ where: { id: sub.id }, data: { netUser: nu, transferredAt: new Date(), transferredTo: nu } });
        await prisma.maintenanceLog.create({
          data: {
            subscriberId: sub.id,
            details: `تحويل اليوزر من «${sub.netUser ?? "—"}» إلى «${nu}»`,
            technicianName: tech?.name ?? null, cardTitle: card.title, kind: card.kind, durationSec, date: new Date(),
          },
        });
      }
      // سجل صيانات المشترك (بلا صور) — للصيانة/التنصيب التي لها تفاصيل
      if (!isDelivery && !isTransfer && serviceDetails?.trim()) {
        await prisma.maintenanceLog.create({
          data: {
            subscriberId: sub.id,
            details: serviceDetails.trim(),
            technicianName: tech?.name ?? null,
            cardTitle: card.title,
            kind: card.kind,
            durationSec,
            date: new Date(),
          },
        });
      }
      // رسالة واتساب للمشترك (قالب "رسالة الصيانة/التنصيب")
      const tpl = await prisma.smsTemplate.findFirst({ where: { type: "maintenance" } });
      if (sub.phone && tpl?.text && tpl.enable !== "0") {
        const office = towerId ? await prisma.tower.findUnique({ where: { id: towerId }, select: { name: true, waEnabled: true } }) : null;
        if (office?.waEnabled !== "0") {
          const text = renderTemplate(tpl.text, {
            name: sub.name, netUser: sub.netUser, kind: card.kind,
            details: serviceDetails?.trim() ?? "", amount, date: formatDate(new Date()),
            technician: tech?.name ?? "", office: office?.name ?? "شكيب نت",
          });
          let res: { ok: boolean; error?: string };
          try { res = await sendViaProvider("WHATSAPP", sub.phone, text, towerId); }
          catch (e) { res = { ok: false, error: e instanceof Error ? e.message : "تعذّر الإرسال" }; }
          messaged = res.ok;
          await prisma.message.create({
            data: {
              channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
              status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
              createdByUser: String(session.userId ?? ""),
            },
          });
        }
      }
    }
  } catch {
    // تجاهل: الإنجاز تمّ بنجاح بغضّ النظر عن الرسالة/السجل
  }

  return NextResponse.json({ ok: true, salesShare, pettyShare, hasPhoto: !!photo, matchedSubscriber, messaged });
}
