import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { sendMail, mailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// رسالة المالك للوكلاء عبر الإيميل (فرديّة أو جماعيّة). للمالك حصراً (guardOwner).
// تُرسَل لبريد كلّ وكيل (agent.backupEmail). مَن بلا بريد يُعاد اسمه في noEmail.
const schema = z.object({
  subject: z.string().min(1, "عنوان الرسالة مطلوب"),
  body: z.string().min(1, "نص الرسالة مطلوب"),
  agentIds: z.array(z.coerce.number().int()).min(1, "اختر وكيلاً واحداً على الأقل"),
});

export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { subject, body, agentIds } = parsed.data;

  if (!mailerConfigured()) {
    return NextResponse.json({ error: "البريد غير مضبوط (SMTP) — اضبطه أولاً لإرسال الرسائل" }, { status: 400 });
  }

  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds }, isDeleted: false },
    select: { id: true, name: true, backupEmail: true },
  });

  let sent = 0;
  const noEmail: string[] = [];
  const failed: string[] = [];
  for (const a of agents) {
    const to = (a.backupEmail ?? "").trim();
    if (!to) { noEmail.push(a.name ?? `وكيل ${a.id}`); continue; }
    const r = await sendMail({ to, subject, text: body });
    if (r.ok) sent++; else failed.push(a.name ?? `وكيل ${a.id}`);
  }

  return NextResponse.json({ ok: true, sent, noEmail, failed });
}
