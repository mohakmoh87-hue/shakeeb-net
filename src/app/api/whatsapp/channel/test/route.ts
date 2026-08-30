import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { loadWaChannel, sendViaUltraMsg } from "@/lib/waChannel";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!can(session, "whatsapp.connect")) {
    return NextResponse.json({ error: "ليس لديك صلاحية ربط/فصل واتساب المكتب" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const officeId = Number(body?.officeId);
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "أدخِل رقمَ الاختبار" }, { status: 400 });
  if (!(await ownsTower(session, officeId))) {
    return NextResponse.json({ error: "مكتبٌ ليس لك" }, { status: 403 });
  }

  const cfg = await loadWaChannel(officeId);
  if (!cfg || !cfg.instanceId || !cfg.token) {
    return NextResponse.json({ error: "احفظ Instance ID والToken أوّلاً ثمّ اختبر" }, { status: 400 });
  }
  const r = await sendViaUltraMsg(cfg, phone, "✅ رسالةُ اختبارٍ من نظام شكيب نت عبر UltraMsg — القناةُ تعمل.");
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error ?? "فشل الإرسال" });
}
