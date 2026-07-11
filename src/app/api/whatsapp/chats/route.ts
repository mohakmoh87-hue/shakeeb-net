import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { getOfficeChats } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// محادثات واتساب مكتب محدّد (?officeId=)
export async function GET(request: Request) {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;
  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  try {
    const chats = await getOfficeChats(officeId);
    return NextResponse.json({ chats });
  } catch {
    return NextResponse.json({ chats: [], error: "تعذّر جلب المحادثات — تأكد أن واتساب المكتب متصل" });
  }
}
