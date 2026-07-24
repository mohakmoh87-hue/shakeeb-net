import { NextResponse } from "next/server";
import { createPublicKey, createVerify, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";
import { guard, ownsTower } from "@/lib/guard";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { regOptions, regVerify, authOptions, authVerify, CHALLENGE_TTL_MS } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

// تحقّق توقيع ECDSA-SHA256 من مفتاح الجهاز الأصلي (SPKI base64) على تحدّي الخادم.
function verifyNativeSignature(spkiB64: string, challenge: string, sigB64: string): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(spkiB64, "base64"), format: "der", type: "spki" });
    const v = createVerify("SHA256");
    v.update(Buffer.from(challenge, "utf8"));
    v.end();
    return v.verify(pub, Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}

// GET (فني): حالة تسجيله. native = مفتاح جهاز أصلي مربوط بالحساب؛ registered = تسجيل WebAuthn (المتصفح).
export async function GET() {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { bioCredId: true, bioPublicKey: true } });
  const native = !!(t?.bioPublicKey && !t?.bioCredId); // مفتاح جهاز أصلي = مفتاح عام بلا credId
  const registered = !!(t?.bioCredId && t?.bioPublicKey); // WebAuthn = credId + مفتاح عام (المتصفح)
  return NextResponse.json({ registered, native });
}

async function clearChallenge(id: number) {
  await prisma.technician.update({ where: { id }, data: { bioChallenge: null, bioChallengeAt: null } }).catch(() => {});
}

// POST (فني): تدفّق البصمة الأصلية (native-*) للتطبيق، وWebAuthn (reg-*/auth-*) للمتصفح.
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: string; response?: unknown; publicKey?: unknown; signature?: unknown } | null;
  const action = body?.action;
  const t = await prisma.technician.findUnique({
    where: { id: tech.technicianId },
    select: { id: true, name: true, bioCredId: true, bioPublicKey: true, bioCounter: true, bioChallenge: true, bioChallengeAt: true },
  });
  if (!t) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  const challengeFresh = !!(t.bioChallenge && t.bioChallengeAt && Date.now() - t.bioChallengeAt.getTime() < CHALLENGE_TTL_MS);
  const hasResponse = !!body?.response && typeof body.response === "object";

  // ===== البصمة الأصلية (التطبيق): مفتاح جهاز مربوط بالحساب تشفيرياً =====
  // تسجيل مفتاح الجهاز — مقفول: لا يُقبل مفتاح جديد إن وُجد مفتاح (يمنع فنياً من انتحال حساب
  // زميل بتسجيل جهازه) — إعادة التسجيل تتطلّب مسح المدير.
  if (action === "native-enroll") {
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey : "";
    if (!publicKey || publicKey.length < 40 || publicKey.length > 4000) return NextResponse.json({ error: "مفتاح غير صالح" }, { status: 400 });
    if (t.bioPublicKey) return NextResponse.json({ error: "البصمة مُسجَّلة مسبقاً — اطلب من المدير مسحها لإعادة التسجيل" }, { status: 409 });
    await prisma.technician.update({ where: { id: t.id }, data: { bioPublicKey: publicKey, bioCredId: null, bioCounter: null, bioChallenge: null, bioChallengeAt: null } });
    return NextResponse.json({ ok: true });
  }
  if (action === "native-challenge") {
    if (!t.bioPublicKey || t.bioCredId) return NextResponse.json({ error: "لا بصمة مُسجَّلة" }, { status: 400 });
    const challenge = randomBytes(32).toString("base64url");
    await prisma.technician.update({ where: { id: t.id }, data: { bioChallenge: challenge, bioChallengeAt: new Date() } });
    return NextResponse.json({ challenge });
  }
  if (action === "native-verify") {
    const signature = typeof body?.signature === "string" ? body.signature : "";
    if (!challengeFresh || !signature) return NextResponse.json({ verified: false, error: "انتهت صلاحية الطلب — أعد المحاولة" }, { status: 400 });
    if (!t.bioPublicKey || t.bioCredId) return NextResponse.json({ verified: false, error: "لا بصمة مُسجَّلة" }, { status: 400 });
    const ok = verifyNativeSignature(t.bioPublicKey, t.bioChallenge!, signature);
    await clearChallenge(t.id); // التحدّي يُستهلك مرة واحدة (نجاحاً أو فشلاً) — منع إعادة التشغيل
    if (!ok) return NextResponse.json({ verified: false, error: "لم تُطابق البصمة" }, { status: 400 });
    return NextResponse.json({ verified: true });
  }

  // ===== WebAuthn (المتصفح): تسجيل ثم مصادقة =====
  if (action === "reg-options") {
    // قفل: لا تسجيل جديد إن وُجد مفتاح (أصلي أو WebAuthn) — يمنع الكتابة فوقه أو انتحال حساب زميل
    if (t.bioPublicKey) return NextResponse.json({ error: "البصمة مُسجَّلة مسبقاً — اطلب من المدير مسحها لإعادة التسجيل" }, { status: 409 });
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
  const sp = new URL(request.url).searchParams;
  // مسح بصمات جميع فنيّي الوكيل دفعةً واحدة (بداية دوام/إعادة تسجيل شاملة)
  if (sp.get("all") === "1") {
    const agentId = g.session?.agentId ?? null;
    if (agentId == null) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
    const r = await prisma.technician.updateMany({
      where: { agentId, isDeleted: false },
      data: { bioCredId: null, bioPublicKey: null, bioCounter: null, bioChallenge: null, bioChallengeAt: null },
    });
    return NextResponse.json({ ok: true, cleared: r.count });
  }
  const id = Number(sp.get("technicianId"));
  if (!id) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  const tech = await prisma.technician.findUnique({ where: { id }, select: { towerId: true } });
  if (!tech || !(await ownsTower(g.session, tech.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  await prisma.technician.update({ where: { id }, data: { bioCredId: null, bioPublicKey: null, bioCounter: null, bioChallenge: null, bioChallengeAt: null } });
  return NextResponse.json({ ok: true });
}
