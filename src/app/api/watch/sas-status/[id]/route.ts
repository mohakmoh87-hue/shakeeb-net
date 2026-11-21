import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerScope } from "@/lib/viewerScope";
import { sasBaseUrl, sasLogin, sasFetchUserOnline } from "@/lib/sas4";
import { credsOfSubscriber } from "@/lib/sasPanel";

export const dynamic = "force-dynamic";

// 👁️ حالةُ اتصال المشترك للمشاهد (متصل/غير متصل) — عند ضغطةِ المستخدم فقط، لا استطلاعَ دوريّ.
// نظيرُ `/api/subscribers/[id]/sas-status` بعزلِ المشاهد بدل صلاحيّة «تفعيل الاشتراكات».
// وذاكرةُ الرمز مستقلّةٌ عن ذاكرة المسار الأصليّ (وهو الذي لم يُلمَس) — الكلفةُ دخولُ
// ساسٍ إضافيٌّ كلَّ عشر دقائق لا أكثر، والمنطقُ الفعليُّ في `sas4`/`sasPanel` مشترَكٌ أصلاً.
const tokenCache = new Map<number, { token: string; base: string; at: number }>();
const TOKEN_TTL = 10 * 60 * 1000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sc = await viewerScope();
  if (!sc) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const { id } = await params;
  const subId = Number(id);
  const sub = await prisma.subscriber.findUnique({
    where: { id: subId },
    select: { netUser: true, towerId: true, isDeleted: true },
  });
  if (!sub || sub.isDeleted || sub.towerId == null || !sc.towerIds.includes(sub.towerId)) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  if (!sub.netUser) return NextResponse.json({ online: null });

  const creds = await credsOfSubscriber(subId);
  if (!creds) return NextResponse.json({ online: null });
  // 🔑 مفتاحُ الذاكرة يحمل اللوحة: لوحتان في مكتبٍ واحدٍ لكلٍّ رمزُها، وخلطُهما يُفشل الاستعلام
  const tid = creds.panelId != null ? -creds.panelId : sub.towerId;

  const getToken = async (fresh: boolean) => {
    let tk = tokenCache.get(tid);
    if (fresh || !tk || Date.now() - tk.at > TOKEN_TTL) {
      const base = sasBaseUrl(creds.loginUrl);
      const token = await sasLogin(base, creds.username, creds.password);
      tk = { token, base, at: Date.now() };
      tokenCache.set(tid, tk);
    }
    return tk;
  };

  try {
    let tk = await getToken(false);
    let online = await sasFetchUserOnline(tk.base, tk.token, sub.netUser);
    if (online === null) {
      tk = await getToken(true);
      online = await sasFetchUserOnline(tk.base, tk.token, sub.netUser);
    }
    return NextResponse.json({ online });
  } catch {
    return NextResponse.json({ online: null });
  }
}
