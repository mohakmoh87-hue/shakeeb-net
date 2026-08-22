import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { listDeletedReceipts } from "@/app/api/_lib/deletedReceipts";

export const dynamic = "force-dynamic";

// ═════ 🗑️ سجلُّ الوصولات المحذوفة — المرحلةُ الأولى (طلبُ محمد 2026-08-22) ═════
// 🔒 بصلاحيّة «سجل الوصولات المحذوفة» (`receipts.deleted`) وبعزل الوكيل ومكاتبه.
// ✋ **قراءةٌ محضة**: لا كتابةَ ولا إرجاعَ في هذه المرحلة — زرُّ الإرجاع وحُرّاسُه
//    مرحلةٌ ثانيةٌ مستقلّة. واختبارٌ بنيويٌّ يفشل إن دخلت كتابةٌ هذا المسار.

export async function GET(req: Request) {
  const g = await guard("receipts.deleted");
  if (g.error) return g.error;

  const sp = new URL(req.url).searchParams;
  const data = await listDeletedReceipts(g.session ?? null, {
    from: sp.get("from"),
    to: sp.get("to"),
    on: sp.get("on"),
    q: sp.get("q"),
    tower: sp.get("tower"),
    kind: sp.get("kind"),
    limit: sp.get("limit"),
  });

  return NextResponse.json(data);
}
