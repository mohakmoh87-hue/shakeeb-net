import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { sasBaseUrl, sasLogin, sasFindUserByUsername, type SasUser } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { credsOfSubscriber } from "@/lib/sasPanel";
import { matcherForAgent } from "@/lib/packageMatch";

export const dynamic = "force-dynamic";

// استبدال مشترك (طلب محمد 2026-07-30): ساكن جديد يأخذ نفس اليوزر مكان من ترك الخدمة.
// سير العمل الفعلي: محمد يحدّث معلومات الساكن الجديد في SAS أولاً (اسم/هاتف/باقة/انتهاء)،
// ثم يضغط «استبدال» فيسحبها الموقع من SAS تلقائياً — لا ملء يدوي.
// - GET: معاينة — بيانات اليوزر الحالية من SAS + الباقة المطابقة عندنا.
// - POST: التنفيذ — القديم يبقى بكل تاريخه (وصولات/صيانات/ديون) ويوزره يوسم «سابق»
//   وتبقى رسائله مفعّلة عمداً (محمد يستهدف تاركي الخدمة بحملات الاسترجاع)؛
//   والجديد يأخذ اليوزر النظيف وربط SAS ومعلومات المكان، وبياناته من SAS.

async function fetchSasForSubscriber(subscriberId: number) {
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!sub || sub.isDeleted) return { error: "المشترك غير موجود", status: 404 as const };
  if (!sub.netUser?.trim()) return { error: "المشترك بلا يوزر — لا يمكن الاستبدال", status: 400 as const };
  if (sub.netUser.includes("#سابق")) return { error: "هذا سجل مشترك سابق — الاستبدال يكون من السجل الحامل لليوزر الحالي", status: 400 as const };
  // أ-٢٣ · بياناتُ ساس **لوحة المشترك** لا أعمدة المكتب (والسقوطُ إليها = السلوكُ القديم)
  const sasCreds = await credsOfSubscriber(subscriberId);
  if (!sasCreds) {
    return { error: "مكتب المشترك غير مربوط بـ SAS", status: 400 as const };
  }
  if (await sasHostBlocked(sasCreds.loginUrl)) return { error: "عنوان لوحة المكتب غير مسموح", status: 403 as const };
  const base = sasBaseUrl(sasCreds.loginUrl);
  const token = await sasLogin(base, sasCreds.username, sasCreds.password);
  const sas = await sasFindUserByUsername(base, token, sub.netUser);
  if (!sas) return { error: `اليوزر «${sub.netUser}» غير موجود في SAS — حدّثه هناك أولاً`, status: 404 as const };
  // مطابقة باقة SAS مع باقاتنا — متسامحة مع الفراغات وحالة الأحرف وترتيب الكلمات
  const matcher = await matcherForAgent(sasCreds.agentId);
  const pkgId = matcher.match(sas.packageName);
  const pkg = pkgId != null
    ? await prisma.package.findUnique({ where: { id: pkgId }, select: { id: true, name: true } })
    : null;
  return { sub, sas, pkg };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const { id } = await params;
  const r = await fetchSasForSubscriber(Number(id));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!(await sameAgentTower(g.session, r.sub.towerId))) return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  return NextResponse.json({
    old: { id: r.sub.id, name: r.sub.name, netUser: r.sub.netUser, carry: r.sub.carry ?? 0 },
    sas: r.sas,
    matchedPackage: r.pkg,
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const session = await getSession();
  const { id } = await params;

  let r: Awaited<ReturnType<typeof fetchSasForSubscriber>>;
  try { r = await fetchSasForSubscriber(Number(id)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message || "فشل الاتصال بـ SAS" }, { status: 502 }); }
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { sub: old, sas, pkg } = r;
  if (!(await sameAgentTower(g.session, old.towerId))) return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });

  const cleanUser = old.netUser!.trim();
  // وسم بغداد: yyyyMMdd-HHmm — يمنع تصادم يوزرين ويؤرّخ الاستبدال في الوسم نفسه
  const iq = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const stamp = `${iq.getUTCFullYear()}${String(iq.getUTCMonth() + 1).padStart(2, "0")}${String(iq.getUTCDate()).padStart(2, "0")}-${String(iq.getUTCHours()).padStart(2, "0")}${String(iq.getUTCMinutes()).padStart(2, "0")}`;
  const day = `${String(iq.getUTCDate()).padStart(2, "0")}/${String(iq.getUTCMonth() + 1).padStart(2, "0")}/${iq.getUTCFullYear()}`;

  const [, created] = await prisma.$transaction([
    // القديم: أرشيف حي كامل التاريخ — يوزره يوسم، وربط SAS يُفك (يذهب للجديد)،
    // وواتسابه يبقى مفعّلاً عمداً (حملات استرجاع تاركي الخدمة)
    prisma.subscriber.update({
      where: { id: old.id },
      data: {
        netUser: `${cleanUser}#سابق-${stamp}`,
        sasId: null,
        state: "سابق",
        note: `${old.note ? `${old.note}\n` : ""}[استبدال ${day}] ترك الخدمة وحلّ محله «${sas.name ?? "مشترك جديد"}» على اليوزر «${cleanUser}»`,
      },
    }),
    // الجديد: بيانات الشخص من SAS + معلومات المكان/الجهاز من السجل القديم + مالية نظيفة
    prisma.subscriber.create({
      data: {
        name: sas.name ?? "مشترك جديد",
        phone: sas.phone,
        netUser: cleanUser,
        // 🔗 **رقمُ الساس الحيُّ لا رقمُ الصفّ القديم** (بلاغُ محمد 2026-08-21): كان يُنسَخ
        // `old.sasId` — وهو رقمٌ **ميّتٌ** حين تُعيد الشركةُ إنشاءَ الحساب (حالةُ bg-5-12-11@mu:
        // نُسخ 160586 والحيُّ 495405). فلا تجده المزامنةُ بالرقم، فتراه «يوزراً بلا صفّ»
        // ⇒ **كانت تُنشئ مشتركاً مكرَّراً**. والرقمُ مقروءٌ لتوّه من الساس في `sas`.
        sasId: sas.sasId ?? old.sasId,
        towerId: old.towerId,
        // أ-٢٣ · البديلُ يأخذ **لوحةَ ساس السابق** — فهو على اليوزر نفسِه في المُخدِّم نفسِه.
        // ولولا هذا لَوُلد بلا لوحةٍ فسقط إلى لوحة المكتب الأولى ⇒ **تفعيلٌ على اللوحة الخطأ**.
        sasPanelId: old.sasPanelId,
        groupId: old.groupId,
        packageId: pkg?.id ?? old.packageId,
        dateTo: sas.expiration ? new Date(sas.expiration) : null,
        dateFrom: new Date(),
        address: old.address, sector: old.sector,
        wifiUser: old.wifiUser, wifiPass: old.wifiPass,
        userNano: old.userNano, passNano: old.passNano, ipNano: old.ipNano,
        ftth: old.ftth, mac: old.mac, subPassword: old.subPassword, cardCode: old.cardCode,
        waEnabled: true,
        carry: 0, rewardBalance: 0, rewardGrantCount: 0,
        createdByUser: session?.username, createdByName: session?.fullName,
        note: `استبدال ${day}: أخذ اليوزر «${cleanUser}» من المشترك السابق «${old.name ?? "—"}»`,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId, action: "REPLACE_SUBSCRIBER", entity: "subscriber", entityId: String(old.id),
        details: `استبدال على اليوزر «${cleanUser}»: السابق «${old.name ?? "—"}» (بقي بسجله) ← الجديد «${sas.name ?? "—"}» (هاتف ${sas.phone ?? "—"}، باقة ${sas.packageName ?? "—"}، انتهاء ${sas.expiration ?? "—"})`,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, newId: created.id, sas: sas as SasUser }, { status: 201 });
}
