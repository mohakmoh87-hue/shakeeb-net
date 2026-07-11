import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { getOfficeMessages } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// رسائل محادثة محدّدة (?officeId=&chatId=)
export async function GET(request: Request) {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const officeId = Number(url.searchParams.get("officeId"));
  const chatId = url.searchParams.get("chatId");
  if (!officeId || !chatId) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  try {
    const messages = await getOfficeMessages(officeId, chatId);
    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json({ messages: [], error: "تعذّر جلب الرسائل" });
  }
}
