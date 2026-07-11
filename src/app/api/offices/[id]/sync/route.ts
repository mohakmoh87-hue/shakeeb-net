import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { runOfficeSync } from "@/lib/subscriptionSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// مزامنة اشتراكات مكتب يدوياً الآن (تفحص SAS وتحدّث المتغيّرين + تبلّغ عن التفعيلات الخارجية)
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  // المزامنة الثقيلة تعمل من العامل المحلي فقط (RUN_WORKER)، لا من استضافة الويب (Vercel)
  if (process.env.RUN_WORKER !== "1") {
    return NextResponse.json(
      { error: "المزامنة تُنفَّذ من حاسبة المكتب (العامل المحلي). افتح البرنامج من حاسبة مكتب مشغّلة." },
      { status: 503 },
    );
  }
  const { id } = await params;
  // مزامنة يدوية: لا تُرسل رسالة للمدير (النتيجة تظهر في الواجهة)
  const res = await runOfficeSync(Number(id), { notify: false });
  return NextResponse.json(res);
}
