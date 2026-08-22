import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { restoreReceipt } from "@/app/api/_lib/restoreReceipt";
import { DEL_KINDS, type DelKind } from "@/app/api/_lib/deletedReceipts";

export const dynamic = "force-dynamic";

// ═════ ♻️ إرجاعُ وصلٍ محذوف — المرحلةُ الثانية (طلبُ محمد 2026-08-22) ═════
// 🔒 بصلاحيّة «سجل الوصولات المحذوفة» وبعزل الوكيل ومكاتبه (يُعاد التحقّقُ في كلّ كتابة).
// 🔎 `dryRun: true` يُعيد **خطّةَ الإرجاع وموانعَه** بلا كتابةِ حرف — والواجهةُ تعرضها
//    قبل التنفيذ، فلا يضغط أحدٌ زرّاً لا يعرف أثرَه.

export async function POST(req: Request) {
  const g = await guard("receipts.deleted");
  if (g.error) return g.error;

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(b.kind ?? "");
  const id = Number(b.id) || 0;
  if (!DEL_KINDS.includes(kind as DelKind) || id <= 0) {
    return NextResponse.json({ error: "نوعُ الوثيقة أو رقمُها غيرُ صحيح" }, { status: 400 });
  }
  const overrides = Array.isArray(b.overrides) ? b.overrides.filter((x): x is string => typeof x === "string") : [];

  try {
    const res = await restoreReceipt(g.session ?? null, {
      kind: kind as DelKind,
      id,
      dryRun: b.dryRun === true,
      overrides,
    });
    // مانعٌ قائمٌ ⇒ 409 لا 200: الواجهةُ تعرض السببَ ولا تزعم نجاحاً
    return NextResponse.json(res, { status: res.ok ? 200 : 409 });
  } catch {
    return NextResponse.json({ error: "تعذّر إرجاع الوصل — لم يتغيّر شيء" }, { status: 500 });
  }
}
