import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushAgentToOdoo, agentHasLiveWorker } from "@/lib/odooSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===== بديلٌ سحابيّ لدفع أودو عند إغلاق المكاتب (طلب محمد 2026-08-09) =====
// أودو محليٌّ على العامل بقرار الأجور — لكنّ مكتباً مغلقاً كان يعني ملاحظة تأجيلٍ لا تصل أودو
// (حصل فعلاً: بطاقة الشهداء #1137 بقيت معلّقةً بعد منتصف الليل). فهذا المسار **بديلٌ لا أصل**:
//   • لا يعمل إلّا إن **لم ينبض أيّ عامل للوكيل** خلال ١٥ دقيقة (الحاسبات مطفأة).
//   • يدفع **الإنجاز/الإلغاء وملاحظة التأجيل** حصراً — **لا سحبَ ولا واتساب ولا إرسالاً تلقائيّاً**.
//   • لا يلمس أودو إطلاقاً إن لم يكن هناك معلّق (لا دخول، لا مكالمة) ⇒ كلفةٌ تكاد لا تُذكر.
// يُنادى كلّ ١٥ دقيقة خلال نافذة العمل من GitHub Actions، محميّاً بـCRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }

  // وكلاءُ لهم مكتبٌ واحدٌ على الأقلّ بربط أودو مفعّل وببيانات دخول
  const towers = await prisma.tower.findMany({
    where: { isDeleted: false, odooEnabled: "1", odooUser: { not: null }, odooPass: { not: null }, agentId: { not: null } },
    select: { agentId: true },
  });
  const agentIds = [...new Set(towers.map((t) => t.agentId as number))];

  const out: { agentId: number; skipped?: string; pushed?: number; notes?: number; error?: string }[] = [];
  for (const agentId of agentIds) {
    // عاملٌ حيٌّ ⇒ هو صاحب العمل، والسحابة لا تتدخّل (ولا تُزاحمه على نفس البطاقة)
    if (await agentHasLiveWorker(agentId)) { out.push({ agentId, skipped: "عاملٌ محليّ يعمل" }); continue; }
    try {
      const r = await pushAgentToOdoo(agentId);
      out.push({ agentId, ...r });
    } catch (e) {
      out.push({ agentId, error: String((e as Error).message ?? "خطأ").slice(0, 160) });
    }
  }
  const total = out.reduce((s, r) => s + (r.pushed ?? 0) + (r.notes ?? 0), 0);
  if (total > 0) console.log(`[cron/odoo-push] دُفِع ${total} (السحابة — المكاتب مغلقة)`);
  return NextResponse.json({ ok: true, agents: out.length, total, out });
}
