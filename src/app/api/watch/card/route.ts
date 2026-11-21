import { NextResponse } from "next/server";
import { viewerScope } from "@/lib/viewerScope";
import { createCardFromSubscriber } from "@/lib/cardFromSubscriber";

export const dynamic = "force-dynamic";

// 👁️ رفعُ بطاقةٍ من مستخدم المشاهدة — نفسُ منطق `/api/field/from-subscriber` حرفيّاً
// (حارسُ البطاقة المرفوعة · مبلغُ باقة التوصيل · التوزيعُ التلقائيّ · سجلُّ التغييرات).
// والفرقان الوحيدان: المِلكيّةُ تُقاس بنطاق المشاهد، و**لا اختيارَ فنيّ** (قرارُ محمد)
// فأيُّ `technicianId` في الطلب يُهمَل خادميّاً لا في الواجهة وحدَها.
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
    },
    {
      agentId: sc.viewer.agentId,
      actorName: sc.viewer.name || sc.viewer.username,
      ownerTowerIds: sc.towerIds,
      allowManualTech: false,
    },
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, listName: res.listName }, { status: 201 });
}
