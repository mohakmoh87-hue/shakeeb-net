import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import { subscriberState } from "@/lib/subscriberLogin";

export const dynamic = "force-dynamic";
const PAGE = 30;

// مشتركو التطبيق لأدمن التطبيق — **دورٌ عالميٌّ عابرٌ للوكلاء** (كطبيعة التطبيق: الدخولُ يبحث
// في كلّ الوكلاء). العدّادُ = من دخلوا التطبيق (lastAppLoginAt). البحثُ يشمل كلَّ المشتركين
// كي يُحظَر أيُّ أحدٍ (حتى قبل أوّل دخول). لا يُكشَف سرٌّ: اسم·هاتف·حالة·حظر·آخرُ دخولٍ فقط.
export async function GET(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // العدّادات (ثابتةٌ بلا بحث): كم مشتركاً استعمل التطبيق، وكم منهم خلال ٣٠ يوماً، وكم محظور
  const [totalAppUsers, active30, banned] = await Promise.all([
    prisma.subscriber.count({ where: { isDeleted: false, purgedAt: null, lastAppLoginAt: { not: null } } }),
    prisma.subscriber.count({ where: { isDeleted: false, purgedAt: null, lastAppLoginAt: { gte: since30 } } }),
    prisma.subscriber.count({ where: { isDeleted: false, purgedAt: null, appBanned: true } }),
  ]);

  // القائمة: بحثٌ ⇒ كلُّ المشتركين (لحظر أيّ أحد)؛ بلا بحثٍ ⇒ مستعملو التطبيق فقط (الأحدثُ دخولاً)
  const where = q
    ? { isDeleted: false, purgedAt: null, OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] }
    : { isDeleted: false, purgedAt: null, lastAppLoginAt: { not: null } };
  const total = await prisma.subscriber.count({ where });
  const rows = await prisma.subscriber.findMany({
    where,
    select: { id: true, name: true, phone: true, appBanned: true, lastAppLoginAt: true, dateTo: true },
    orderBy: q ? { id: "desc" } : { lastAppLoginAt: "desc" },
    take: PAGE,
    skip: (page - 1) * PAGE,
  });

  const subscribers = rows.map((r) => {
    const st = subscriberState(r.dateTo);
    return {
      id: r.id, name: r.name, phone: r.phone, appBanned: r.appBanned,
      lastAppLoginAt: r.lastAppLoginAt, state: st.state, daysExpired: st.daysExpired,
    };
  });
  return NextResponse.json({ counts: { totalAppUsers, active30, banned }, subscribers, total, page, pages: Math.ceil(total / PAGE) });
}

const patchSchema = z.object({ id: z.coerce.number().int().positive(), banned: z.boolean() });

// حظرُ/فكُّ حظرِ مشترك — يُنفَّذ في مسار الدخول (`/api/app/login/*` و`/me`) فوراً.
export async function PATCH(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const sub = await prisma.subscriber.findFirst({ where: { id: parsed.data.id, isDeleted: false, purgedAt: null }, select: { id: true } });
  if (!sub) return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  await prisma.subscriber.update({ where: { id: sub.id }, data: { appBanned: parsed.data.banned } });
  return NextResponse.json({ ok: true, banned: parsed.data.banned });
}
