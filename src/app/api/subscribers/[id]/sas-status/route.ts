import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasFetchUserOnline } from "@/lib/sas4";
import { credsOfSubscriber } from "@/lib/sasPanel";

export const dynamic = "force-dynamic";

// كاش رمز الساس لكل مكتب — يتفادى إعادة تسجيل الدخول عند كلّ ضغطة، فأسرع استجابة ممكنة.
const tokenCache = new Map<number, { token: string; base: string; at: number }>();
const TOKEN_TTL = 10 * 60 * 1000; // ١٠ دقائق

// حالة اتصال المشترك من الساس (متصل/غير متصل) — عند الطلب فقط (ضغط المستخدم على المشترك).
// لا تُستدعى إطلاقاً إلا بضغطة المستخدم؛ لا استطلاع دوريّ.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const subId = Number(id);

  // عزل المستأجر: المشترك يجب أن يتبع وكيل المستخدم
  const sub = await prisma.subscriber.findUnique({
    where: { id: subId },
    select: { netUser: true, towerId: true, isDeleted: true },
  });
  if (!sub || sub.isDeleted || !(await sameAgentTower(g.session, sub.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  if (!sub.netUser || sub.towerId == null) return NextResponse.json({ online: null }); // بلا يوزر ساس

  // أ-٢٣ · بياناتُ ساس **لوحة المشترك** لا أعمدة المكتب (المكتبُ مُتحقَّقٌ ملكيّتُه أعلاه).
  // والسقوطُ: لوحتُه ← لوحةُ المكتب الأولى ← أعمدةُ المكتب = السلوكُ القديم بالضبط.
  const creds = await credsOfSubscriber(subId);
  if (!creds) return NextResponse.json({ online: null }); // إعداد ساس ناقص
  // 🔑 مفتاحُ ذاكرة الرمز يحمل **اللوحة**: لوحتان في مكتبٍ واحدٍ لكلٍّ رمزُها، وخلطُهما
  // يُرسل رمزَ لوحةٍ إلى مُخدِّم الأخرى فيفشل الاستعلامُ صامتاً.
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
      // قد تكون الجلسة انتهت قبل TTL — أعد الدخول مرّةً وحاول ثانيةً
      tk = await getToken(true);
      online = await sasFetchUserOnline(tk.base, tk.token, sub.netUser);
    }
    return NextResponse.json({ online });
  } catch {
    return NextResponse.json({ online: null });
  }
}
