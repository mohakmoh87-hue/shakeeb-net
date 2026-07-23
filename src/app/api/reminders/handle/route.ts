import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { runExpiringReminder } from "@/lib/scheduler";

const schema = z.object({
  officeId: z.coerce.number(),
  send: z.boolean().default(false), // true = أرسل الآن، false = تجاهل اليوم
});

// معالجة تذكير الانتهاء لمكتب عند دخول المستخدم: إرسال الآن أو تجاهل لليوم
export async function POST(request: Request) {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const { officeId, send } = parsed.data;

  // عزل المستأجر: لا إرسال/ختم تذكير لمكتبٍ لا يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, officeId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  if (send) {
    // runExpiringReminder يختم lastReminderDate=today تلقائياً
    const res = await runExpiringReminder([officeId]);
    return NextResponse.json({ ok: true, ...res });
  }
  // تجاهل: اختم اليوم فقط دون إرسال (فلا يتكرر الطلب)
  const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await prisma.tower.update({ where: { id: officeId }, data: { lastReminderDate: today } });
  return NextResponse.json({ ok: true, dismissed: true });
}
