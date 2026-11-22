import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession, getAccountSession } from "@/lib/subscriberAuth";
import { phoneCore } from "@/lib/subscriberLogin";
import { clientIp, lookupIsp, ispLabel } from "@/lib/isp";
import { getDiagRefPhone } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// ═════ 🩺 حفظُ فحصِ الإنترنت في سجلّ المشترك (طلبُ محمد 2026-11-22) ═════
//
// 🔴 **الحزمةُ الأصليّةُ وحدَها تصل هنا**: نسخةُ المتصفّح محاكاةٌ بأرقامٍ ثابتةٍ في الكود
//    (تحميل ٦٨ · رفع ٢١٠ · بور −١٩٫٤ · ١٢ جهازاً) لأنّ المتصفّح لا يفتح Socket إلى الراوتر
//    ولا يقرأ إشارةَ الواي‑فاي. فلو سُجّلت لامتلأ سجلٌّ دائمٌ بأرقامٍ مخترَعةٍ تُبنى عليها
//    قراراتُ صيانة (قرارُ محمد). والعلامةُ `platform` تُرفَض إن لم تكن أصليّة.
//
// 🔑 الهويّةُ من الجلسة لا من الطلب: الهاتفُ والمشتركُ يُقرآن من الكوكيّ المُوقَّع،
//    فلا يكتب أحدٌ فحصاً في سجلّ غيره. والزائرُ بلا جلسةٍ لا يُحفَظ له شيء.

const MAX_STAGES = 10;

function num(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < lo || n > hi) return null;
  return Math.round(n * 100) / 100;
}
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

export async function POST(request: Request) {
  // هويّةُ صاحب الفحص — من الجلسة وحدَها
  const subSess = await getSubscriberSession();
  const accSess = subSess ? null : await getAccountSession();
  if (!subSess && !accSess) return NextResponse.json({ saved: false, reason: "guest" });

  let phone = "";
  let subscriberId: number | null = null;
  let appAccountId: number | null = null;
  let towerId: number | null = null;
  let agentId: number | null = null;

  if (subSess) {
    const sub = await prisma.subscriber.findUnique({
      where: { id: subSess.subscriberId },
      select: { id: true, phone: true, towerId: true, appBanned: true },
    });
    if (!sub || sub.appBanned) return NextResponse.json({ saved: false, reason: "banned" });
    subscriberId = sub.id;
    phone = sub.phone ?? "";
    towerId = sub.towerId;
    if (towerId != null) {
      const t = await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } });
      agentId = t?.agentId ?? null;
    }
  } else if (accSess) {
    const acc = await prisma.appAccount.findUnique({
      where: { id: accSess.accountId },
      select: { id: true, phone: true, isBanned: true },
    });
    if (!acc || acc.isBanned) return NextResponse.json({ saved: false, reason: "banned" });
    appAccountId = acc.id;
    phone = acc.phone ?? "";
  }

  const core = phoneCore(phone);
  if (!core) return NextResponse.json({ saved: false, reason: "no-phone" });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });

  const platform = str(body.platform, 20);
  if (platform !== "android" && platform !== "ios") {
    return NextResponse.json({ saved: false, reason: "not-native" });
  }

  // 🌐 المزوّدُ من عنوان الطلب — ولا يُقرأ من الجسم إطلاقاً
  const ip = clientIp(request.headers);
  const isp = ip ? await lookupIsp(ip) : { asn: null, holder: null, onSuperCell: false };

  // 🔬 تفاصيلُ الجهاز الخامّة: للهاتف المرجعيّ وحدَه، ومعرفتُه من الجلسة لا من الطلب
  let refRaw: string | null = null;
  const refPhone = await getDiagRefPhone();
  const refCore = refPhone ? phoneCore(refPhone) : null;
  if (refCore && refCore === core) refRaw = sanitizeRef(body.ref);

  const stages = cleanStages(body.stages);

  await prisma.diagCheck.create({
    data: {
      phoneCore: core,
      phone: phone.slice(0, 40),
      subscriberId,
      appAccountId,
      towerId,
      agentId,
      ip,
      asn: isp.asn,
      ispName: ispLabel(isp),
      onSuperCell: isp.asn == null ? null : isp.onSuperCell,
      pkgMbps: num(body.pkgMbps, 0, 100000),
      routerPingMs: num(body.routerPingMs, -1, 100000),
      netPingMs: num(body.netPingMs, -1, 100000),
      linkMbps: num(body.linkMbps, -1, 100000),
      downMbps: num(body.downMbps, -1, 100000),
      upMbps: num(body.upMbps, -1, 100000),
      opticRx: num(body.opticRx, -60, 20),
      opticErr: str(body.opticErr, 400),
      devices: (() => { const n = num(body.devices, -1, 10000); return n == null ? null : Math.round(n); })(),
      deviceDiag: str(body.deviceDiag, 200),
      summary: str(body.summary, 1200),
      verdict: str(body.verdict, 10),
      stages: stages ?? undefined,
      refRaw,
      appVersion: str(body.appVersion, 40),
      platform,
    },
  });

  return NextResponse.json({
    saved: true,
    isp: ispLabel(isp),
    onSuperCell: isp.asn == null ? null : isp.onSuperCell,
  });
}

function cleanStages(v: unknown): Array<{ key: string; value: string; verdict: string; note: string }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ key: string; value: string; verdict: string; note: string }> = [];
  for (const s of v.slice(0, MAX_STAGES)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    out.push({
      key: str(o.key, 20) ?? "",
      value: str(o.value, 200) ?? "",
      verdict: str(o.verdict, 10) ?? "",
      note: str(o.note, 400) ?? "",
    });
  }
  return out.length ? out : null;
}

// 🔒 عيّنةُ الجهاز الخامّة: محدودةُ الحجم، ويُشطب منها كلُّ ما يشبه كلمةَ مرور.
//    صفحةُ الجهاز قد تحمل كلمةَ PPPoE أو إعداداتِ المزوّد، ولا حاجةَ لنا بها.
export function sanitizeRef(v: unknown): string | null {
  if (v == null) return null;
  let s = typeof v === "string" ? v : JSON.stringify(v);
  if (typeof s !== "string") return null;
  s = s.slice(0, 20000);
  s = s.replace(/((?:pass|pwd|psw|secret|key|token|pppoe)[a-z0-9_]*\s*[=:"']{1,3}\s*)[^"'&,;\s}]{1,120}/gi, "$1***");
  return s.trim() || null;
}
