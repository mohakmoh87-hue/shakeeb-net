import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner, confirmOwnerPassword } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// إجراءاتٌ ثابتةٌ محروسة (للمالك): كلٌّ يتطلّب كلمةَ سرّ المالك ويُسجَّل. لا أوامر نظامٍ حرّة.
export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const body = (await request.json().catch(() => ({}))) as { action?: string; ownerPassword?: string };
  const action = body.action ?? "";
  if (!["vacuum", "analyze", "sync-now"].includes(action)) {
    return NextResponse.json({ error: "إجراءٌ غير معروف" }, { status: 400 });
  }
  if (!(await confirmOwnerPassword(g.session.userId, body.ownerPassword))) {
    return NextResponse.json({ error: "كلمةُ سرّ المالك غير صحيحة" }, { status: 403 });
  }

  let result = "";
  try {
    if (action === "vacuum") {
      await prisma.$executeRawUnsafe("VACUUM (ANALYZE)");
      result = "تمّ VACUUM ANALYZE للقاعدة";
    } else if (action === "analyze") {
      await prisma.$executeRawUnsafe("ANALYZE");
      result = "تمّ تحديثُ إحصاءات القاعدة (ANALYZE)";
    } else if (action === "sync-now") {
      // نداءٌ داخليّ في الخلفيّة — يحتاج إنترنت الساس (لا يعمل على نسخة التجربة المعزولة)
      void (async () => {
        const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
        const offices = await prisma.tower.findMany({ where: { isDeleted: false, syncEnabled: "1" }, select: { id: true } });
        for (const o of offices) await runOfficeSyncAll(o.id, { notify: false }).catch(() => {});
      })().catch(() => {});
      result = "بدأت المزامنةُ في الخلفيّة";
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.slice(0, 400) ?? "فشل الإجراء" }, { status: 500 });
  }

  await prisma.auditLog
    .create({ data: { userId: g.session.userId, action: "OWNER_SERVER_ACTION", entity: "server", entityId: action, details: result } })
    .catch(() => {});
  return NextResponse.json({ ok: true, result });
}
