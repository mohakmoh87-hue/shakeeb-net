import { NextResponse } from "next/server";
import { getCompanySession } from "@/lib/companyAuth";
import { getOtpWaInfo, setOtpWa } from "@/lib/otpWa";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  return NextResponse.json(await getOtpWaInfo());
}

export async function PATCH(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { instanceId?: string; token?: string } | null;
  await setOtpWa({ instanceId: body?.instanceId, token: body?.token });
  return NextResponse.json(await getOtpWaInfo());
}
