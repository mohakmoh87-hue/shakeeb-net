import { NextResponse } from "next/server";
import { getCompanySession } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

// من هي الشركةُ الداخلة؟ (للتحقّق ولبناء لوحة الشركة لاحقاً — القطعة ٥). 401 إن لا جلسة.
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  return NextResponse.json({ username: s.username });
}
