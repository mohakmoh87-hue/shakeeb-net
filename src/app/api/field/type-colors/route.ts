import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ألوان أنواع البطاقات (يغيّرها المدير من «الأنواع والأوقات») — تُلوّن رؤوس الأعمدة
// وشارات النوع في عرض المدير بالمتصفح. تُخزَّن JSON في system_settings بلا تغيير مخطط:
// catColors:{agentId} ⇒ { "توصيل": "#e0940f", ... }
const key = (agentId: number) => `catColors:${agentId}`;

async function readColors(agentId: number): Promise<Record<string, string>> {
  const row = await prisma.systemSetting.findFirst({ where: { type: key(agentId) }, select: { text: true } });
  try { return row?.text ? (JSON.parse(row.text) as Record<string, string>) : {}; } catch { return {}; }
}

export async function GET() {
  const session = await getSession();
  if (!session || session.agentId == null) return NextResponse.json({ colors: {} });
  return NextResponse.json({ colors: await readColors(session.agentId) });
}

export async function PUT(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  if (g.session.agentId == null) return NextResponse.json({ error: "لا وكيل لهذا الحساب" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const color = typeof body?.color === "string" ? body.color.trim() : "";
  if (!name || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return NextResponse.json({ error: "اسم النوع ولون سداسي صحيح مطلوبان" }, { status: 400 });
  }
  const colors = await readColors(g.session.agentId);
  colors[name] = color;
  const type = key(g.session.agentId);
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  const text = JSON.stringify(colors);
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
  return NextResponse.json({ ok: true, colors });
}
