import { NextResponse } from "next/server";
import { appViewer } from "@/lib/subscriberAuth";
import { DIAG_BOOK, validateBook } from "./book";

export const dynamic = "force-dynamic";

// 🩺 كتابُ لهجات أجهزة البور — يقرؤه التطبيقُ قبل المرحلة الخامسة.
// 🔒 خلف جلسةِ التطبيق: الكتابُ يحمل كلمةَ مرور الجهاز، فلا يُقدَّم لمن لا جلسةَ له.
//    (وهي اليومَ داخلَ الحزمة التي ينصّبها كلُّ مشترك، فالنقلُ لا يزيد كشفاً — لكنّه
//     يجعل تغييرَها ممكناً بلا حزمةٍ جديدة، وهو مقصودُ النقل.)
// 🛟 وفشلُ هذا المسار لا يُعطّل شيئاً: التطبيقُ يحمل نسخةً مدمجةً يعمل بها.
export async function GET() {
  const who = await appViewer();
  if (!who) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const errs = validateBook(DIAG_BOOK);
  if (errs.length > 0) return NextResponse.json({ error: "كتابٌ غيرُ صالح" }, { status: 500 });
  return NextResponse.json(DIAG_BOOK, { headers: { "Cache-Control": "no-store" } });
}
