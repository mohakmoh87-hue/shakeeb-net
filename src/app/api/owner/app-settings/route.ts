import { NextResponse } from "next/server";
import { z } from "zod";
import { guardOwner } from "@/lib/guard";
import { getAppContent, setAppContent } from "@/lib/appConfig";
import { getOtpWaInfo, setOtpWa } from "@/lib/otpWa";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  const [content, otpWa] = await Promise.all([getAppContent(), getOtpWaInfo()]);
  return NextResponse.json({ ...content, otpWa });
}

const schema = z.object({
  content: z.unknown().optional(),
  otpWa: z.object({ instanceId: z.string().optional(), token: z.string().optional() }).optional(),
});

export async function PATCH(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const d = parsed.data;
  if (d.content !== undefined) await setAppContent(d.content);
  if (d.otpWa !== undefined) await setOtpWa(d.otpWa);
  return NextResponse.json({ ok: true });
}
