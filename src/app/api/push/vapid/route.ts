import { NextResponse } from "next/server";
import { getSession, getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// المفتاح العام VAPID (يُقرأ وقت التشغيل — لا حاجة لإعادة بناء عند تغييره في البيئة).
// يُقبل المديرُ **والفنيّ**: كلاهما يشترك في Web Push، والمفتاحُ عامٌّ غيرُ سرّيّ.
// (كان يقبل جلسةَ المدير فقط ⇒ الفنيُّ يأخذ 401 فلا يُكمل الاشتراك أبداً.)
export async function GET() {
  const s = (await getSession()) ?? (await getTechSession());
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return NextResponse.json({ publicKey, enabled: !!publicKey });
}
