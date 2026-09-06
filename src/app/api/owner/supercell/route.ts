import { NextResponse } from "next/server";
import { z } from "zod";
import { guardOwner } from "@/lib/guard";
import {
  getAppContent, setAppContent, getCompanyMode, setCompanyMode, getPortalEnabled, setPortalEnabled,
  getCompanyAnalyticsView, setCompanyAnalyticsView, getCompanyPhone, setCompanyPhone,
} from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// ⚙️ تحكّمُ المالك ببوّابة سوبر سيل وإعلانات التطبيق (طلبُ محمد 2026-08-29) — كودٌ جديدٌ معزول
// بحارس المالك حصراً (لا تسجيلَ ذاتيّ). يكتبُ نفسَ مخزَن `appConfig` الذي يقرؤه التطبيق و/supercell.
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  const [content, companyMode, portalEnabled, analyticsView, companyPhone] = await Promise.all([
    getAppContent(), getCompanyMode(), getPortalEnabled(), getCompanyAnalyticsView(), getCompanyPhone(),
  ]);
  return NextResponse.json({ ...content, companyMode, portalEnabled, analyticsView, companyPhone });
}

const schema = z.object({
  content: z.unknown().optional(), // {ads, offers, quick} — يُطهَّر في setAppContent
  companyMode: z.boolean().optional(),
  portalEnabled: z.boolean().optional(),
  analyticsView: z.enum(["tickets", "field", "both"]).optional(),
  companyPhone: z.string().max(20).optional(),
});

export async function PATCH(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const d = parsed.data;
  if (d.content !== undefined) await setAppContent(d.content);
  if (d.companyMode !== undefined) await setCompanyMode(d.companyMode);
  if (d.portalEnabled !== undefined) await setPortalEnabled(d.portalEnabled);
  if (d.analyticsView !== undefined) await setCompanyAnalyticsView(d.analyticsView);
  if (d.companyPhone !== undefined) await setCompanyPhone(d.companyPhone);
  return NextResponse.json({ ok: true });
}
