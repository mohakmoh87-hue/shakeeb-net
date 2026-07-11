import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/guard";
import { sendOfficeChat } from "@/lib/whatsapp";

const schema = z.object({
  officeId: z.coerce.number(),
  chatId: z.string().min(1),
  text: z.string().min(1),
});

// إرسال رد في محادثة واتساب مكتب
export async function POST(request: Request) {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const { officeId, chatId, text } = parsed.data;
  const res = await sendOfficeChat(officeId, chatId, text);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
