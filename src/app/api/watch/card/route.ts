import { NextResponse } from "next/server";
import { viewerScope } from "@/lib/viewerScope";
import { createCardFromSubscriber } from "@/lib/cardFromSubscriber";

export const dynamic = "force-dynamic";

// 👁️ رفعُ بطاقةٍ من مستخدم المشاهدة — نفسُ منطق `/api/field/from-subscriber` حرفيّاً
// (حارسُ البطاقة المرفوعة · مبلغُ باقة التوصيل · التوزيعُ التلقائيّ · سجلُّ التغييرات).
// والفرقُ الوحيد: المِلكيّةُ تُقاس بنطاق المشاهد لا بمكاتب وكيله.
// 🔁 واختيارُ الفنيّ **عاد** بقرار محمد 2026-11-21 بعد أن كان ممنوعاً — والمعرّفُ
//    يُتحقَّق منه خادميّاً بـ`verifyManualAssignee` (وكيلٌ ومكتبٌ ومجموعةُ لوحة).
export async function POST(request: Request) {
  const sc = await viewerScope();
  if (!sc) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const res = await createCardFromSubscriber(
    {
      subscriberId: Number(body?.subscriberId),
      operation: String(body?.operation ?? ""),
      extraPhone: body?.extraPhone,
      note: body?.note,
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
