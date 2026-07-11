import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeDailyReport } from "@/lib/dailyReport";

export const dynamic = "force-dynamic";

// التقرير اليومي لمكتب محدّد أو الإجمالي (لتبويبات تقرير المدير في الشاشة الرئيسية).
// المدير: يختار أي مكتب أو الإجمالي (towerId=all). مستخدم المكتب: مكتبه فقط دائماً.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const param = new URL(request.url).searchParams.get("towerId");
  let towerId: number | null;
  if (session.isAdmin) {
    towerId = !param || param === "all" ? null : Number(param) || null;
  } else {
    towerId = session.towerId ?? null; // مستخدم المكتب مقيّد بمكتبه
  }

  const r = await computeDailyReport(towerId);
  return NextResponse.json(r);
}
