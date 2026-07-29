import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// شعار الوكالة (يظهر بأعلى الشريط الجانبي) — يُخزَّن data URL في system_settings
// بمفتاح agentLogo:{agentId} (بلا تغيير مخطط القاعدة). التغيير بصلاحية agent.settings.
const key = (agentId: number) => `agentLogo:${agentId}`;

export async function GET() {
  const session = await getSession();
  if (!session || session.agentId == null) return NextResponse.json({ logo: null });
  const row = await prisma.systemSetting.findFirst({ where: { type: key(session.agentId) }, select: { text: true } });
  return NextResponse.json({ logo: row?.text ?? null });
}

export async function POST(request: Request) {
  const g = await guard("agent.settings");
  if (g.error) return g.error;
  if (g.session.agentId == null) return NextResponse.json({ error: "لا وكيل لهذا الحساب" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
  if (!dataUrl.startsWith("data:image/")) return NextResponse.json({ error: "اختر صورة صالحة" }, { status: 400 });
  if (dataUrl.length > 300_000) return NextResponse.json({ error: "الصورة كبيرة — اختر صورة أصغر" }, { status: 400 });
  const type = key(g.session.agentId);
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text: dataUrl } });
  else await prisma.systemSetting.create({ data: { type, text: dataUrl } });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const g = await guard("agent.settings");
  if (g.error) return g.error;
  if (g.session.agentId == null) return NextResponse.json({ error: "لا وكيل لهذا الحساب" }, { status: 400 });
  await prisma.systemSetting.deleteMany({ where: { type: key(g.session.agentId) } });
  return NextResponse.json({ ok: true });
}
