import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

// خروج الفني: يمسح الجلسة فقط (بلا تقرير يومي — ذاك خاصّ بالمدير/المستخدم).
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
