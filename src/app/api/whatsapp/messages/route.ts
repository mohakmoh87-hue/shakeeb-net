import { NextResponse } from "next/server";
import { guard, ownsTower } from "@/lib/guard";
import { relayRequest } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// رسائل محادثة محدّدة (?officeId=&chatId=) — عبر المُرحِّل
export async function GET(request: Request) {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const officeId = Number(url.searchParams.get("officeId"));
  const chatId = url.searchParams.get("chatId");
  if (!officeId || !chatId) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  if (!(await ownsTower(g.session, officeId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  const r = await relayRequest(officeId, "messages", { chatId, limit: 40 });
  if (!r.ok) return NextResponse.json({ messages: [], error: r.error });
  return NextResponse.json({ messages: r.result ?? [] });
}
