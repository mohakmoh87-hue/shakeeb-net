import { NextResponse } from "next/server";
import { clearAppAdminSession } from "@/lib/appAdminAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearAppAdminSession();
  return NextResponse.json({ ok: true });
}
