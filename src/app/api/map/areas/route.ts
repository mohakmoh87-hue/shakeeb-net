import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// قائمة رموز مناطق الخريطة المتاحة (من أسماء النقاط: F{B}/{A}/{AREA}) مع عدد النقاط.
// تُستخدم في إعدادات المكتب ليختار الوكيل منطقته.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const rows = await prisma.$queryRawUnsafe<{ area: string; c: bigint }[]>(
    "SELECT split_part(name, '/', 3) AS area, count(*) c FROM map_points GROUP BY 1 ORDER BY 2 DESC",
  );
  const areas = rows
    .filter((r) => r.area && r.area.trim().length > 0)
    .map((r) => ({ code: r.area, count: Number(r.c) }));
  return NextResponse.json({ areas });
}
