import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { createCardFromSubscriber } from "@/lib/cardFromSubscriber";

export const dynamic = "force-dynamic";

// العمليّات ديناميّة = أنواع الوكيل (طلب محمد 2026-08-08): أيّ اسمٍ غير نظاميٍّ مقبول،
// ويقابل عموداً في اللوحة بنفس الاسم + نوعاً في «الأنواع والأوقات».

// إنشاء بطاقة في لوحة إدارة الفنيين انطلاقاً من مشترك:
// يأخذ معلومات المشترك (الاسم، الهاتف، اليوزر) ويضعها في العمود الذي يحمل اسم
// العملية المختارة، ويُنشئ العمود تلقائياً إن لم يكن موجوداً.
//
// 🧩 المنطقُ نفسُه في `@/lib/cardFromSubscriber` منذ 2026-11-21 ليشاركه مسارُ مستخدم
//    المشاهدة بلا نسخ. وملكيّةُ المشترك تُقاس بمكاتب وكيل المستخدم — وهو عينُ ما كانت
//    تفعله `sameAgentTower` (معرّفُ مكتبٍ غيرُ فارغٍ ضمن `agentTowerIds`).
// ===== مبلغا بطاقة التوصيل (تصحيح محمد 2026-08-05) =====
// **الرفع بلا أرقام**: المكتب يرفع البطاقة ولا يُطالَب بكتابة مبلغ إطلاقاً.
// «الاشتراك» يُحسب تلقائياً من باقة المشترك ويظهر على الوجه، و**الفني يعدّله عند الإنجاز
// إن اختلف**، ويكتب «مبلغ التوصيل» هناك (صفر أو أي رقم). فالمبلغ يُعرف عند الباب لا قبله.
export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

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
      agentId: g.session.agentId ?? null,
      actorName: g.session.fullName ?? g.session.username,
      ownerTowerIds: await agentTowerIds(g.session),
      allowManualTech: true,
    },
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, listName: res.listName, card: res.card }, { status: 201 });
}
