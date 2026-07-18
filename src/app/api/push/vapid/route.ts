import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// المفتاح العام VAPID (يُقرأ وقت التشغيل — لا حاجة لإعادة بناء عند تغييره في البيئة).
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return NextResponse.json({ publicKey, enabled: !!publicKey });
}
