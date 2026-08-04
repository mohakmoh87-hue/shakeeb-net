import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ===== سجل تحصيل الفنيين + التراجع عنه (المرحلة ٨) =====
// كان الضغط على «اكمال» يعلّم كل بطاقات الفني محصَّلة ويؤرشفها **بلا أي قيد**
// وبلا إمكان تراجع، والبطاقات تُحذف نهائياً بعد أسبوع — فيضيع أصل الرقم ولا يبقى
// أثرٌ يشرح لماذا نقص تحصيل الفني. الآن لكل تحصيل قيدٌ دائم يُعرض ويمكن سحبه.
//
// ملاحظة محاسبية مقصودة: التحصيل **ليس إيراداً جديداً** — مال «المبيع» سُجّل فاتورةً
// لحظة إنجاز البطاقة. فالقيد هنا توثيقي لا مالي، وإلا احتُسب المبلغ مرتين.

type Details = { tech?: string; by?: string; count?: number; total?: number; sale?: number; sub?: number; cardIds?: number[] };

export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;

  const rows = await prisma.auditLog.findMany({
    where: { action: { in: ["SETTLE_TECH", "SETTLE_TECH_UNDO"] } },
    orderBy: { id: "desc" },
    take: 200,
    select: { id: true, action: true, entityId: true, details: true, createdAt: true, userId: true },
  });

  // عزل: لا تُعرض إلا تحصيلات فنيّي وكيل المستخدم
  const towerIds = await agentTowerIds(g.session);
  const techIds = [...new Set(rows.map((r) => Number(r.entityId)).filter((n) => Number.isFinite(n)))];
  const techs = techIds.length
    ? await prisma.technician.findMany({
        where: { id: { in: techIds }, OR: [{ towerId: { in: towerIds } }, { supportTowerId: { in: towerIds } }] },
        select: { id: true, name: true },
      })
    : [];
  const techName = new Map(techs.map((t) => [t.id, t.name]));

  const undone = new Set(
    rows.filter((r) => r.action === "SETTLE_TECH_UNDO").map((r) => {
      try { return (JSON.parse(r.details ?? "{}") as { of?: number }).of ?? -1; } catch { return -1; }
    }),
  );

  return NextResponse.json({
    rows: rows
      .filter((r) => r.action === "SETTLE_TECH" && techName.has(Number(r.entityId)))
      .map((r) => {
        let d: Details = {};
        try { d = JSON.parse(r.details ?? "{}") as Details; } catch { /* نص فاسد */ }
        return {
          id: r.id,
          date: r.createdAt,
          technicianId: Number(r.entityId),
          technician: techName.get(Number(r.entityId)) ?? d.tech ?? "—",
          by: d.by ?? null,
          count: d.count ?? 0,
          total: d.total ?? 0,
          sale: d.sale ?? 0,
          sub: d.sub ?? 0,
          undone: undone.has(r.id),
        };
      }),
  });
}

// التراجع عن تحصيل: تعود بطاقاته غير محصَّلة وغير مؤرشفة فتظهر في تحصيل الفني من جديد
export async function POST(request: Request) {
  const g = await guard("receipts.void"); // الحذف/التراجع للمدير وحده (شرط محمد)
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });

  const entry = await prisma.auditLog.findUnique({
    where: { id },
    select: { id: true, action: true, entityId: true, details: true },
  });
  if (!entry || entry.action !== "SETTLE_TECH") {
    return NextResponse.json({ error: "قيد التحصيل غير موجود" }, { status: 404 });
  }

  // عزل: الفني يجب أن يتبع مكاتب وكيل المستخدم
  const towerIds = await agentTowerIds(g.session);
  const tech = await prisma.technician.findFirst({
    where: { id: Number(entry.entityId), OR: [{ towerId: { in: towerIds } }, { supportTowerId: { in: towerIds } }] },
    select: { id: true, name: true },
  });
  if (!tech) return NextResponse.json({ error: "الفني لا يتبع حسابك" }, { status: 403 });

  const already = await prisma.auditLog.findFirst({
    where: { action: "SETTLE_TECH_UNDO", details: { contains: `"of":${id}` } },
    select: { id: true },
  });
  if (already) return NextResponse.json({ error: "سُحب هذا التحصيل مسبقاً" }, { status: 400 });

  let d: Details = {};
  try { d = JSON.parse(entry.details ?? "{}") as Details; } catch { /* نص فاسد */ }
  const ids = (d.cardIds ?? []).filter((n) => Number.isFinite(n));
  if (!ids.length) return NextResponse.json({ error: "لا بطاقات مسجّلة في هذا القيد" }, { status: 400 });

  // البطاقات المحذوفة نهائياً (بعد التنظيف الأسبوعي) لا تعود — يُبلَّغ بعددها
  const restored = await prisma.taskCard.updateMany({
    where: { id: { in: ids }, isDeleted: false, settled: true },
    data: { settled: false, archivedAt: null },
  });

  await prisma.auditLog.create({
    data: {
      userId: session?.userId,
      action: "SETTLE_TECH_UNDO",
      entity: "technician",
      entityId: String(tech.id),
      details: JSON.stringify({ of: id, tech: tech.name, restored: restored.count, requested: ids.length }),
    },
  });

  return NextResponse.json({
    ok: true,
    restored: restored.count,
    missing: ids.length - restored.count, // بطاقات حُذفت نهائياً فلم تعد
  });
}
