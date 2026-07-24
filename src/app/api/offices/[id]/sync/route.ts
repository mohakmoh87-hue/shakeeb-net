import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { runOfficeSync } from "@/lib/subscriptionSync";
import { relayRequest } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// مزامنة اشتراكات مكتب يدوياً (تفحص SAS محلياً على حاسبة المكتب عبر المُرحِّل ثم تكتب للسحابة)
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const { id } = await params;
  const towerId = Number(id);

  // عزل: المكتب يجب أن يتبع وكيل المستخدم
  const mine = await agentTowerIds(g.session ?? null);
  if (!mine.includes(towerId)) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  // على العامل نفسه: نفّذ مباشرةً.
  if (process.env.RUN_WORKER === "1") {
    return NextResponse.json(await runOfficeSync(towerId, { notify: false }));
  }
  // على الموقع: نُفضّل حاسبة المكتب (قرب SAS، أسرع). relayRequest يفحص نبضة الحاسبة
  // أولاً فيفشل فوراً إن كانت مطفأة (بلا انتظار المهلة).
  const r = await relayRequest(towerId, "sas", { op: "sync" }, 250_000);
  if (r.ok) return NextResponse.json({ ...(r.result as object), via: "office" });
  // تراجع تلقائي: الحاسبة مطفأة/تعذّرت — نُزامن مباشرةً من السحابة (لوحة SAS على الإنترنت).
  // فيعمل الزر دائماً بغضّ النظر عن حالة الحاسبة (قفل التزامن يمنع أي تعارض).
  const cloud = await runOfficeSync(towerId, { notify: false });
  return NextResponse.json({ ...cloud, via: "cloud" });
}
