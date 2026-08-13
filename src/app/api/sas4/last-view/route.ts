import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getLastView } from "@/lib/sasViewCache";

// إرجاع المشتركين المعروضين حالياً في لوحة SAS4 المضمّنة
export async function GET() {
  const g = await guard("subscribers.import");
  if (g.error) return g.error;
  const session = g.session!;

  const view = getLastView(session.userId);
  if (!view || view.users.length === 0) {
    return NextResponse.json(
      { error: "لم تُعرض أي صفحة في لوحة SAS4 بعد. تصفّح صفحة المشتركين في اللوحة ثم أعد المحاولة." },
      { status: 400 },
    );
  }

  // تمييز المستوردين مسبقاً — ضمن مكاتب وكيل المستخدم فقط (تطابُق sasId مع وكيل آخر لا يعنينا)
  //
  // 🔴 **بلاغُ محمد 2026-08-13**: «في الاستيراد يظهر جميعُ المشتركين وكأنّهم مستوردون فعلاً
  // فلا يمكن استيرادُهم مرّةً أخرى، وذلك حدث **بعد حذفهم**.»
  // والعلّةُ سطرٌ واحدٌ: كان الترشيحُ بلا `isDeleted: false` ⇒ **المحذوفُ ناعماً يُعَدُّ
  // «مستورداً»** فتُقفَل الشاشةُ عليه ولا سبيلَ إلى إعادته. ووقع فعلاً: حُذف ٢١٧٢ مشتركاً
  // من صميم حذفاً ناعماً فظهروا كلُّهم «مستوردين».
  // **والمحذوفُ ليس مستورداً — هو محذوف.** ومسارُ الاستيراد نفسُه (`sas4/import:59`) يُرشِّح
  // بـ`isDeleted: false` أصلاً ⇒ كانت الشاشةُ تقول «مستورد» والاستيرادُ يقول «غيرُ مستورد»،
  // فرقمان لحقيقةٍ واحدةٍ — وهو ما يُقفل البابَ بلا أن يُخطئ أحد.
  //
  // ونُضيَّق الرقعةُ إلى **مكتب العرض نفسِه** لا كلِّ مكاتب الوكيل: فمشتركٌ برقمٍ مشابهٍ في
  // مكتبٍ آخرَ للوكيل نفسِه كان يُقفل استيرادَ هذا المشترك ظلماً — والاستيرادُ يُنشئه بالفعل.
  const { agentTowerIds } = await import("@/lib/guard");
  const towers = await agentTowerIds(session);
  const scope = view.towerId != null && towers.includes(view.towerId)
    ? [view.towerId]
    : (towers.length ? towers : [-1]);
  const existing = await prisma.subscriber.findMany({
    where: { sasId: { in: view.users.map((u) => u.sasId) }, towerId: { in: scope }, isDeleted: false },
    select: { sasId: true },
  });
  const existingIds = new Set(existing.map((e) => e.sasId));

  return NextResponse.json({
    towerId: view.towerId,
    users: view.users.map((u) => ({ ...u, alreadyImported: existingIds.has(u.sasId) })),
  });
}
