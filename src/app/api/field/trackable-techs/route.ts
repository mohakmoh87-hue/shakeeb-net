import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { isFieldManager } from "@/lib/field";

export const dynamic = "force-dynamic";

// قائمة الفنيين القابلين للتتبع (لودجة/نافذة التتبع). معزولة بالوكيل:
// - المدير: كل فنيّي مكاتب وكيله (كل المكاتب دفعة واحدة).
// - مستخدم المكتب: فنيّو مكتبه فقط.
// لا يقبل جلسة فني (getSession تُرجِع null للفني ⇒ 401) — الفني لا يتتبّع غيره.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const agentTowers = await agentTowerIds(session);
  const manager = isFieldManager(session);
  // نطاق الأبراج ضمن وكيل المستخدم حصراً
  const towerIds = manager
    ? agentTowers
    : session.towerId != null && agentTowers.includes(session.towerId)
      ? [session.towerId]
      : [];
  if (towerIds.length === 0) return NextResponse.json({ manager, technicians: [] });

  const offices = await prisma.tower.findMany({
    where: { id: { in: towerIds }, isDeleted: false },
    select: { id: true, name: true },
  });
  const officeName = new Map(offices.map((o) => [o.id, o.name ?? ""]));

  // فنيّو مكاتب المستخدم + الفنيون المُعارون «دعماً» إلى أحد مكاتبه (يُتتبَّعون من المكتب الطالب
  // للدعم ما دام الدعم قائماً). عند انتهاء الدعم يعود التتبع لمكتبهم الأصلي تلقائياً.
  const techs = await prisma.technician.findMany({
    where: { isDeleted: false, OR: [{ towerId: { in: towerIds } }, { supportTowerId: { in: towerIds } }] },
    select: { id: true, name: true, towerId: true, supportTowerId: true },
    orderBy: [{ towerId: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    manager,
    technicians: techs.map((t) => {
      // المكتب الفعّال للتتبع = مكتب الدعم إن كان مُعاراً، وإلا مكتبه الأصلي
      const onSupport = t.supportTowerId != null && towerIds.includes(t.supportTowerId);
      const effTower = onSupport ? t.supportTowerId! : t.towerId;
      return {
        id: t.id,
        name: onSupport ? `${t.name} (دعم)` : t.name,
        towerId: t.towerId,
        office: effTower != null ? officeName.get(effTower) ?? "" : "",
      };
    }),
  });
}
