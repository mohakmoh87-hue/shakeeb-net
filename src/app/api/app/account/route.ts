import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore, findSubscriberByPhone } from "@/lib/subscriberLogin";
import { sendOtpWhatsApp } from "@/lib/otpWa";
import { setAccountSession, getAccountSession } from "@/lib/subscriberAuth";
import { ensureMarketTable, cleanPhoto } from "@/lib/market";
import { hashPassword } from "@/lib/auth";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// 👤 حسابُ «غير مشترك» (طلبُ محمد 2026-10-26): يسجّل برقمه واسمه الثلاثيّ ومنطقته —
// ثلاثتُها إلزاميّة — ويُتحقَّق من الرقم برمزِ واتساب كالمشترك تماماً.
// 🔴 ولا صفَّ في `subscribers`: جدولٌ مستقلٌّ وجلسةٌ بنوعٍ مغاير، فلا يصل هذا الحساب
//    إلى أيّ مسارِ مشتركٍ ولا يدخل في عدّاداتِ المكاتب ولا المزامنةِ ولا المال.

const OTP_KEY = (core: string) => `acctOtp:${core}`;
const OTP_TTL = 5 * 60_000;
const MAX_TRIES = 5;

function threePartName(v: string): boolean {
  return v.trim().split(/\s+/).filter((w) => w.length >= 2).length >= 3;
}

// الخطوةُ ١: بياناتُه ⇒ رمزٌ إلى واتساب
export async function POST(request: Request) {
  if (!rateLimit(`acct-reg:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  await ensureMarketTable();
  const b = await request.json().catch(() => null);
  const core = phoneCore(typeof b?.phone === "string" ? b.phone : "");
  const name = typeof b?.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const area = typeof b?.area === "string" ? b.area.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const nickname = typeof b?.nickname === "string" ? b.nickname.replace(/\s+/g, " ").trim().slice(0, 40) : "";

  if (!core) return NextResponse.json({ error: "رقمُ هاتفٍ غير صالح" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "الاسمُ الثلاثيُّ مطلوب" }, { status: 400 });
  if (!threePartName(name)) return NextResponse.json({ error: "اكتب اسمَك الثلاثيَّ كاملاً" }, { status: 400 });
  if (!area) return NextResponse.json({ error: "المنطقةُ مطلوبة" }, { status: 400 });
  if (!rateLimit(`acct-reg-phone:${core}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: "طلباتٌ كثيرةٌ لهذا الرقم، انتظر قليلاً" }, { status: 429 });
  }

  // 🔑 رقمٌ هو أصلاً مشتركٌ عندك ⇒ لا يُفتَح له حسابُ «غير مشترك»: يدخل بحسابه هو،
  //    وإلّا صار للشخص الواحد هويّتان وضاعت بياناتُه بينهما.
  if (await findSubscriberByPhone(core)) {
    return NextResponse.json({ status: "is_subscriber", error: "رقمُك مسجّلٌ لدى وكيل — ادخل بحسابك كمشترك" }, { status: 400 });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await prisma.systemSetting.deleteMany({ where: { type: OTP_KEY(core) } });
  await prisma.systemSetting.create({
    data: { type: OTP_KEY(core), value: JSON.stringify({ code, name, area, nickname, phone: "0" + core, expiresAt: Date.now() + OTP_TTL, attempts: 0 }) },
  });
  const r = await sendOtpWhatsApp("0" + core, `رمزُ دخولك إلى تطبيق سوبر سيل: ${code}\nصالحٌ ٥ دقائق. لا تُشاركه مع أحد.`);
  if (!r.ok) {
    await prisma.systemSetting.deleteMany({ where: { type: OTP_KEY(core) } }).catch(() => {});
    return NextResponse.json({ status: "send_failed", error: r.error ?? "تعذّر إرسالُ الرمز" }, { status: 502 });
  }
  return NextResponse.json({ status: "otp_sent" });
}

// الخطوةُ ٢: الرمز ⇒ يُنشأ الحسابُ (أو يُحدَّث) وتُفتَح الجلسة
export async function PUT(request: Request) {
  if (!rateLimit(`acct-vrf:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  await ensureMarketTable();
  const b = await request.json().catch(() => null);
  const core = phoneCore(typeof b?.phone === "string" ? b.phone : "");
  const code = typeof b?.code === "string" ? b.code.trim() : "";
  if (!core || !code) return NextResponse.json({ error: "أدخِل الرقمَ والرمز" }, { status: 400 });

  const row = await prisma.systemSetting.findFirst({ where: { type: OTP_KEY(core) }, orderBy: { id: "desc" }, select: { id: true, value: true } });
  if (!row?.value) return NextResponse.json({ error: "اطلب رمزاً جديداً" }, { status: 400 });
  let d: { code?: string; name?: string; area?: string; nickname?: string; phone?: string; expiresAt?: number; attempts?: number };
  try { d = JSON.parse(row.value); } catch { return NextResponse.json({ error: "اطلب رمزاً جديداً" }, { status: 400 }); }
  if (!d.expiresAt || Date.now() > d.expiresAt) {
    await prisma.systemSetting.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json({ error: "انتهت صلاحيّةُ الرمز — اطلب رمزاً جديداً" }, { status: 400 });
  }
  if ((d.attempts ?? 0) >= MAX_TRIES) {
    await prisma.systemSetting.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json({ error: "محاولاتٌ كثيرة — اطلب رمزاً جديداً" }, { status: 400 });
  }
  if (d.code !== code) {
    await prisma.systemSetting.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...d, attempts: (d.attempts ?? 0) + 1 }) } }).catch(() => {});
    return NextResponse.json({ error: "رمزٌ غير صحيح" }, { status: 400 });
  }
  await prisma.systemSetting.delete({ where: { id: row.id } }).catch(() => {});

  // 🔑 كلمةُ المرور تُضبَط مع التحقّق (طلبُ محمد 2026-10-28): فالرمزُ أثبت ملكيّةَ الرقم،
  //    وبعدها يدخل بكلمته كالمشترك بدل رمزٍ في كلّ مرّة. وهي اختياريّةٌ فلا ينكسر
  //    تطبيقٌ قديمٌ لا يرسلها.
  const password = typeof b?.password === "string" ? b.password : "";
  if (password && password.length < 6) {
    return NextResponse.json({ error: "كلمةُ المرور ٦ أحرفٍ على الأقلّ" }, { status: 400 });
  }
  const passHash = password ? await hashPassword(password) : undefined;

  const acc = await prisma.appAccount.upsert({
    where: { phoneCore: core },
    create: { phoneCore: core, phone: d.phone ?? "0" + core, name: d.name ?? "", area: d.area ?? "", nickname: d.nickname || null, passHash: passHash ?? null, lastLogin: new Date() },
    update: { name: d.name ?? undefined, area: d.area ?? undefined, nickname: d.nickname || undefined, passHash, lastLogin: new Date() },
    select: { id: true, isBanned: true },
  });
  if (acc.isBanned) return NextResponse.json({ error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });
  await setAccountSession(acc.id);
  return NextResponse.json({ ok: true });
}

// بياناتُ حسابِ غير المشترك لشاشاته
export async function GET() {
  const sess = await getAccountSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const acc = await prisma.appAccount.findUnique({
    where: { id: sess.accountId },
    select: { name: true, phone: true, area: true, nickname: true, photo: true, createdAt: true },
  });
  if (!acc) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  return NextResponse.json({ ...acc, kind: "account" });
}

// ✏️🖼️ تعديلُ صاحبِ الحساب لبياناته: صورتُه الشخصيّة واسمُه المستعار (طلبُ محمد 2026-10-28).
// 🔒 صفُّ صاحب الجلسة وحدَه — ولا يُقبَل معرّفٌ من الطلب. وهو نظيرُ `PATCH /api/app/me`
//    للمشترك حرفاً بحرف، بنفس منقّي الصور وبنفس الحدود.
export async function PATCH(request: Request) {
  const sess = await getAccountSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureMarketTable();
  const acc = await prisma.appAccount.findUnique({ where: { id: sess.accountId }, select: { id: true, isBanned: true } });
  if (!acc) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (acc.isBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });

  const b = await request.json().catch(() => null);
  const data: { photo?: string | null; nickname?: string | null } = {};
  if (b?.photo === null) data.photo = null;
  else if (typeof b?.photo === "string") {
    const clean = cleanPhoto(b.photo);
    if (!clean) return NextResponse.json({ error: "صورةٌ غيرُ صالحة أو كبيرةٌ جدّاً" }, { status: 400 });
    data.photo = clean;
  }
  if (typeof b?.nickname === "string") {
    const raw = b.nickname.replace(/\s+/g, " ").trim();
    if (raw && raw.length < 2) return NextResponse.json({ error: "الاسمُ المستعار حرفان على الأقلّ" }, { status: 400 });
    if (raw.length > 40) return NextResponse.json({ error: "الاسمُ المستعار طويلٌ جدّاً" }, { status: 400 });
    data.nickname = raw || null;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.appAccount.update({ where: { id: acc.id }, data });
  return NextResponse.json({ ok: true });
}
