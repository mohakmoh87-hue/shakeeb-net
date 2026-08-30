import { NextResponse } from "next/server";
import { clearSubscriberSession } from "@/lib/subscriberAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearSubscriberSession();
  return NextResponse.json({ ok: true });
}
