import { NextResponse } from "next/server";
import { getPublicAppConfig } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// 🌐 إعداداتُ تطبيق المشترك — **عامٌّ للقراءة فقط، بلا وكيلٍ ولا بيانات مشترك** (طلبُ محمد 2026-08-29).
// يقرؤه بناءُ Flutter (public/kabina-web) عند الإقلاع ليعرضَ الإعلاناتِ الحيّة ووضعَ الشركة.
// لا يُعيدُ إلا بياناتِ الشركة العامّة — فلا تسريبَ لأيّ صفٍّ خاصٍّ بوكيلٍ أو مشترك.
export async function GET() {
  try {
    const cfg = await getPublicAppConfig();
    return NextResponse.json(cfg, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // لا نكسرُ التطبيق: يسقط إلى ثوابته المدمجة إن تعذّر الجلب
    return NextResponse.json({ error: "config unavailable" }, { status: 503 });
  }
}
