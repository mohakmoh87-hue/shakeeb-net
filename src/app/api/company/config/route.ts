import { NextResponse } from "next/server";
import { getCompanySession } from "@/lib/companyAuth";
import { getAppContent, setAppContent } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// تحريرُ الشركة للإعلانات/العروض/الاختصارات — **نفسُ مخزَن المالك** (آخرُ من يكتب يفوز).
// الشركةُ تحرّرُ **المحتوى فقط**؛ الأعلامُ (وضعُ الشركة/تفعيلُ البوّابة) للمالك حصراً.
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  return NextResponse.json(await getAppContent());
}

export async function PATCH(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = await request.json().catch(() => null);
  await setAppContent((body as { content?: unknown } | null)?.content); // يُطهَّر داخل setAppContent
  return NextResponse.json({ ok: true });
}
