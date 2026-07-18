import { NextResponse } from "next/server";
import { guard, ownsTower } from "@/lib/guard";
import { relayRequest } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// تنزيل وسائط رسالة واتساب (?officeId=&msgId=) — عبر المُرحِّل (الوكيل يُنزّلها ويُعيدها base64)
export async function GET(request: Request) {
  const g = await guard("whatsapp.chat");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const officeId = Number(url.searchParams.get("officeId"));
  const msgId = url.searchParams.get("msgId");
  if (!officeId || !msgId) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  if (!(await ownsTower(g.session, officeId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  // مهلة ضمن حدّ دالة Vercel (لا نتجاوز ~10ث وإلا تُقطَع الدالة فيظهر خطأ الجلب)
  const r = await relayRequest(officeId, "media", { msgId }, 9000);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const m = (r.result ?? {}) as { data?: string; mimetype?: string; filename?: string; error?: string };
  if (m.error || !m.data) {
    const map: Record<string, string> = { "too-large": "الملف كبير جداً للعرض", expired: "انتهت صلاحية الوسائط", "no-media": "لا توجد وسائط", unavailable: "تعذّر تنزيل الوسائط" };
    return NextResponse.json({ error: map[m.error ?? ""] ?? "تعذّر تنزيل الوسائط" }, { status: 400 });
  }
  return NextResponse.json({ data: m.data, mimetype: m.mimetype, filename: m.filename });
}
