import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { mailerConfigured } from "@/lib/mailer";
import { sendAgentBackupEmail } from "@/lib/backupJob";

export const dynamic = "force-dynamic";

// إرسال النسخة الاحتياطية الآن إلى إيميل الوكيل (اختبار/طلب يدوي)
export async function POST() {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });

  if (!mailerConfigured()) {
    return NextResponse.json({ error: "خدمة البريد غير مُفعّلة على الخادم بعد (بيانات SMTP غير مضبوطة)" }, { status: 503 });
  }
  const r = await sendAgentBackupEmail(agentId);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "تعذّر الإرسال" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
