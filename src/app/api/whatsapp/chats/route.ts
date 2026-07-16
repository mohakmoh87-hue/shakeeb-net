import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { relayRequest } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// محادثات واتساب مكتب محدّد (?officeId=) — عبر المُرحِّل (الوكيل يملك العميل الحيّ)
export async function GET(request: Request) {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;
  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  const r = await relayRequest(officeId, "chats", { limit: 40 });
  if (!r.ok) return NextResponse.json({ chats: [], error: r.error });
  return NextResponse.json({ chats: r.result ?? [] });
}
