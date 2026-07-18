import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, setTechSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// دخول الفني إلى تطبيق إدارة الفنيين: اسم مستخدم فريد + رمز.
export async function POST(request: Request) {
  if (!rateLimit(`techlogin:${clientIp(request)}`, 8, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  const parsed = z.object({ username: z.string().min(1), code: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const tech = await prisma.technician.findFirst({ where: { username: parsed.data.username.trim(), isDeleted: false } });
  if (!tech || !tech.code) return NextResponse.json({ error: "اسم المستخدم أو الرمز غير صحيح" }, { status: 401 });

  const ok = await verifyPassword(parsed.data.code, tech.code);
  if (!ok) return NextResponse.json({ error: "اسم المستخدم أو الرمز غير صحيح" }, { status: 401 });

  await setTechSession({ kind: "technician", technicianId: tech.id, name: tech.name, username: tech.username ?? "", agentId: tech.agentId, towerId: tech.towerId });
  return NextResponse.json({ ok: true });
}
