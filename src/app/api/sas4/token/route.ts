import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { sasBaseUrl, sasLogin } from "@/lib/sas4";
import { relayRequest } from "@/lib/whatsapp";

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

  const tower = await prisma.tower.findUnique({ where: { id: parsed.data.towerId } });
  if (!tower || !tower.loginUrl || !tower.username || !tower.password) {
    return NextResponse.json({ error: "بيانات المكتب ناقصة" }, { status: 400 });
  }

  try {
    const base = sasBaseUrl(tower.loginUrl);
    // عبر حاسبة المكتب (أسرع) إن كانت مشغّلة، وإلا مباشرةً من الموقع
    const relayed = await relayRequest(tower.id, "sas", { op: "token" }, 15_000);
    const token = (relayed.ok && (relayed.result as { token?: string })?.token)
      ? (relayed.result as { token: string }).token
      : await sasLogin(base, tower.username, tower.password);
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
