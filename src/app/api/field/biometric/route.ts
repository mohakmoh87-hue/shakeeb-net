import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";
import { guard, ownsTower } from "@/lib/guard";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { regOptions, regVerify, authOptions, authVerify, CHALLENGE_TTL_MS } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

// GET (فني): هل بصمته مُسجَّلة خادمياً؟ (وجود مفتاح عام — المعرّف القديم بلا مفتاح لا يُعدّ مُسجَّلاً)
export async function GET() {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { bioCredId: true, bioPublicKey: true } });
  return NextResponse.json({ registered: !!(t?.bioCredId && t?.bioPublicKey) });
}

async function clearChallenge(id: number) {
  await prisma.technician.update({ where: { id }, data: { bioChallenge: null, bioChallengeAt: null } }).catch(() => {});
}

// POST (فني): تدفّق WebAuthn الخادمي — reg-options / reg-verify / auth-options / auth-verify
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: string; response?: unknown } | null;
  const action = body?.action;
  const t = await prisma.technician.findUnique({
    where: { id: tech.technicianId },
    select: { id: true, name: true, bioCredId: true, bioPublicKey: true, bioCounter: true, bioChallenge: true, bioChallengeAt: true },
  });
  if (!t) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  const challengeFresh = !!(t.bioChallenge && t.bioChallengeAt && Date.now() - t.bioChallengeAt.getTime() < CHALLENGE_TTL_MS);
  const hasResponse = !!body?.response && typeof body.response === "object";

  // تسجيل: طلب الخيارات ثم التحقق
  if (action === "reg-options") {
    const options = await regOptions(request, t.name);
    await prisma.technician.update({ where: { id: t.id }, data: { bioChallenge: options.challenge, bioChallengeAt: new Date() } });
    return NextResponse.json({ options });
  }
  if (action === "reg-verify") {
    if (!challengeFresh || !hasResponse) return NextResponse.json({ error: "انتهت صلاحية الطلب — أعد المحاولة" }, { status: 400 });
    const res = await regVerify(request, body!.response as RegistrationResponseJSON, t.bioChallenge!);
    if (!res) { await clearChallenge(t.id); return NextResponse.json({ error: "تعذّر التحقق من البصمة" }, { status: 400 }); }
    await prisma.technician.update({ where: { id: t.id }, data: { bioCredId: res.credId, bioPublicKey: res.publicKey, bioCounter: res.counter, bioChallenge: null, bioChallengeAt: null } });
    return NextResponse.json({ ok: true });
  }

  // مصادقة: طلب الخيارات ثم التحقق بالمفتاح العام المخزَّن
  if (action === "auth-options") {
    if (!t.bioCredId || !t.bioPublicKey) return NextResponse.json({ error: "لا بصمة مُسجَّلة" }, { status: 400 });
    const options = await authOptions(request, t.bioCredId);
    await prisma.technician.update({ where: { id: t.id }, data: { bioChallenge: options.challenge, bioChallengeAt: new Date() } });
    return NextResponse.json({ options });
  }
  if (action === "auth-verify") {
    if (!challengeFresh || !hasResponse) return NextResponse.json({ error: "انتهت صلاحية الطلب — أعد المحاولة" }, { status: 400 });
    if (!t.bioCredId || !t.bioPublicKey) return NextResponse.json({ error: "لا بصمة مُسجَّلة" }, { status: 400 });
    const res = await authVerify(request, body!.response as AuthenticationResponseJSON, t.bioChallenge!, { credId: t.bioCredId, publicKey: t.bioPublicKey, counter: t.bioCounter ?? 0 });
    if (!res) { await clearChallenge(t.id); return NextResponse.json({ verified: false, error: "لم تُطابق البصمة" }, { status: 400 }); }
    await prisma.technician.update({ where: { id: t.id }, data: { bioCounter: res.newCounter, bioChallenge: null, bioChallengeAt: null } });
    return NextResponse.json({ verified: true });
  }

  return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 });
}

// DELETE (المدير): مسح بصمة فني ليُعيد تسجيلها — زر «مسح البصمة» في تعديل الفني
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("technicianId"));
  if (!id) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  const tech = await prisma.technician.findUnique({ where: { id }, select: { towerId: true } });
  if (!tech || !(await ownsTower(g.session, tech.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  await prisma.technician.update({ where: { id }, data: { bioCredId: null, bioPublicKey: null, bioCounter: null, bioChallenge: null, bioChallengeAt: null } });
  return NextResponse.json({ ok: true });
}
