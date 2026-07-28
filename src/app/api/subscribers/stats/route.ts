import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { towerScope } from "@/lib/guard";

// إحصاء المشتركين (فعالين/كلي) من القاعدة — ارتداد لعدّاد أ5 عند غياب حاسبة المكتب.
// يُستدعى مرة واحدة عند فتح الصفحة فقط (بلا استطلاع دوري) لتقليل الاستهلاك؛
// التحديث كل 5 ثوانٍ يتم حصراً من العامل المحلي (localSasServer /stats/subscribers).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const scope = await towerScope(session);
  const now = new Date();
  const [total, active] = await Promise.all([
    prisma.subscriber.count({ where: { isDeleted: false, ...scope } }),
    prisma.subscriber.count({ where: { isDeleted: false, ...scope, dateTo: { gt: now } } }),
  ]);
  return NextResponse.json({ active, total });
}
