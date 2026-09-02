import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession } from "@/lib/companyAuth";
import {
  getCompanyCardCategories, setCompanyCardCategories, getCompanyCardSlaHours, setCompanyCardSlaHours,
  getAgentInboxCategories, setAgentInboxCategories,
} from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// إعدادُ بطاقات الشركة ووارد الوكلاء: فئاتٌ + مهلةٌ افتراضيّة + فئاتُ الوارد + قائمةُ الوكلاء.
// GET لأيّ جلسةِ شركة، وتحريرُ الفئات/المهلة للمدير فقط.
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const [categories, slaHours, agentCategories, agents] = await Promise.all([
    getCompanyCardCategories(), getCompanyCardSlaHours(), getAgentInboxCategories(),
    prisma.agent.findMany({ where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ categories, slaHours, agentCategories, agents });
}

export async function PATCH(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (s.role !== "manager") return NextResponse.json({ error: "للمدير حصراً" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const out: { categories?: string[]; slaHours?: number; agentCategories?: string[] } = {};
  if (Array.isArray(body?.categories)) out.categories = await setCompanyCardCategories(body.categories);
  if (body?.slaHours != null) { await setCompanyCardSlaHours(Number(body.slaHours)); out.slaHours = await getCompanyCardSlaHours(); }
  if (Array.isArray(body?.agentCategories)) out.agentCategories = await setAgentInboxCategories(body.agentCategories);
  return NextResponse.json({ ok: true, ...out });
}
