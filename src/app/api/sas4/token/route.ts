import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { sasBaseUrl, sasLogin } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";

const schema = z.object({ towerId: z.coerce.number() });

// جلب توكن SAS4 للمكتب (لتسجيل الدخول التلقائي في الصفحة المضمّنة)
export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  // عزل المستأجر: لا يُصدَّر توكن SAS إلا لمكتب يتبع وكيل المستخدم (يمنع فتح لوحة وكيل آخر)
  if (!(await ownsTower(g.session, parsed.data.towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const tower = await prisma.tower.findUnique({ where: { id: parsed.data.towerId } });
  if (!tower || !tower.loginUrl || !tower.username || !tower.password) {
    return NextResponse.json({ error: "بيانات المكتب ناقصة" }, { status: 400 });
  }
  // حماية SSRF: امنع اتصال الخادم بعنوان لوحة داخلي/محلي (يمرّ IP العام للوحات SAS)
  if (await sasHostBlocked(tower.loginUrl)) {
    return NextResponse.json({ error: "عنوان لوحة المكتب غير مسموح" }, { status: 403 });
  }

  try {
    const base = sasBaseUrl(tower.loginUrl);
    const token = await sasLogin(base, tower.username, tower.password);
    // مسار الـ API عبر البروكسي (نفس origin البرنامج)
    const apiUrl = `/sas/${tower.id}/admin/api/index.php/api/`;
    const host = tower.loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    const res = NextResponse.json({ token, apiUrl });
    // كوكي المضيف والمكتب لبروكسي /admin/* والتقاط العرض
    res.cookies.set("sas_host", host, { path: "/", httpOnly: true, sameSite: "lax" });
    res.cookies.set("sas_tower", String(tower.id), { path: "/", httpOnly: true, sameSite: "lax" });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "فشل تسجيل الدخول إلى SAS4" },
      { status: 502 },
    );
  }
}
