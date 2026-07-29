import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// أرقام الفعالين/المتصلين/الكلي المرفوعة من حاسبات المكاتب (كل 5 دقائق) —
// للمشاهد البعيد (خارج المكتب/الهاتف) بقراءة كل 5 دقائق (قرار محمد 2026-07-29).
// الجالس على حاسبة مكتب لا يمرّ من هنا أصلاً (عدّاده المحلي الحي أولوية).
export async function GET() {
  const session = await getSession();
  if (!session || session.agentId == null) return NextResponse.json({ at: null, offices: {} });
  const row = await prisma.systemSetting.findFirst({
    where: { type: `subStats:${session.agentId}` },
    select: { text: true },
  });
  let data: { at: string | null; offices: Record<string, { active: number; total: number; online: number | null }> } = { at: null, offices: {} };
  try { if (row?.text) data = JSON.parse(row.text); } catch { /* نص فاسد — نتجاهله */ }
  // مستخدم المكتب: أرقام مكتبه فقط (عزل)
  if (!session.isAdmin && session.towerId != null) {
    const mine = data.offices[String(session.towerId)];
    data = { at: data.at, offices: mine ? { [String(session.towerId)]: mine } : {} };
  }
  return NextResponse.json(data);
}
