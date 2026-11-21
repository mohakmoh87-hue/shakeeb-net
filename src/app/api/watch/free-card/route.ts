import { NextResponse } from "next/server";
import { viewerScope } from "@/lib/viewerScope";
import { createFreeCard } from "@/lib/cardFromSubscriber";

export const dynamic = "force-dynamic";

// 👁️🆕 بطاقةٌ حرّةٌ من المشاهد — لمشتركٍ **غيرِ موجودٍ في القاعدة** (تنصيبٌ جديد).
// نصٌّ حرٌّ ونوعٌ من أعمدة المكتب وفنيٌّ اختياريّ. والمكتبُ يُصادَق ضدّ نطاقه داخلَ الدالّة.
export async function POST(request: Request) {
  const sc = await viewerScope();
  if (!sc) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const body = await request.json().catch(() => null);
  // نطاقُ «مكتبه وحدَه» لا يختار مكتباً أصلاً — فيسقط على مكتبه الوحيد
  const officeId = sc.viewer.viewAllOffices ? Number(body?.officeId) : sc.towerIds[0]!;

  const res = await createFreeCard(
    {
      officeId,
      operation: String(body?.operation ?? ""),
      text: String(body?.text ?? ""),
      technicianId: body?.technicianId != null ? Number(body.technicianId) : null,
    },
    {
      agentId: sc.viewer.agentId,
      actorName: sc.viewer.name || sc.viewer.username,
      ownerTowerIds: sc.towerIds,
      allowManualTech: true,
    },
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, listName: res.listName }, { status: 201 });
}
