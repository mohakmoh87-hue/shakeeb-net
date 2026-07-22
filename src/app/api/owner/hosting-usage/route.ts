import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// استخدام الاستضافة (Azure Container Apps) مقابل المنحة المجانية الشهرية.
// المصدر: مهمة GitHub مجدولة تقرأ المقاييس من Azure وترسلها هنا (POST محميّ بـCRON_SECRET)،
// ثم تعرضها لوحة المالك (GET محميّ بجلسة المالك). التطبيق نفسه لا يملك بيانات اعتماد Azure.
const KEY = "hosting:usage";

// المنحة المجانية الدائمة لـ Azure Container Apps (تتجدّد شهرياً)
const GRANT = {
  requests: 2_000_000, // طلب/شهر
  vcpuSeconds: 180_000, // ثانية-معالج/شهر
  gibSeconds: 360_000, // GiB-ثانية ذاكرة/شهر
};

type Usage = {
  month: string; // YYYY-MM
  requests: number;
  vcpuSeconds?: number;
  gibSeconds?: number;
  updatedAt: string; // ISO
  source?: string;
};

// ===== استقبال القياس من المهمة المجدولة (Bearer CRON_SECRET، نفس نمط كرون auto-checkout) =====
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Partial<Usage> | null;
  if (!body || typeof body.requests !== "number") {
    return NextResponse.json({ error: "requests مطلوب (عدد)" }, { status: 400 });
  }
  const usage: Usage = {
    month: typeof body.month === "string" ? body.month : new Date().toISOString().slice(0, 7),
    requests: Math.max(0, Math.round(body.requests)),
    vcpuSeconds: typeof body.vcpuSeconds === "number" ? Math.max(0, Math.round(body.vcpuSeconds)) : undefined,
    gibSeconds: typeof body.gibSeconds === "number" ? Math.max(0, Math.round(body.gibSeconds)) : undefined,
    updatedAt: new Date().toISOString(),
    source: typeof body.source === "string" ? body.source.slice(0, 40) : "azure-monitor",
  };
  const json = JSON.stringify(usage);
  const existing = await prisma.systemSetting.findFirst({ where: { type: KEY } });
  if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { text: json } });
  else await prisma.systemSetting.create({ data: { type: KEY, text: json } });
  return NextResponse.json({ ok: true, stored: usage });
}

// ===== قراءة للوحة المالك: الاستخدام المخزَّن + حدود المنحة + النسب المحسوبة =====
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;

  const row = await prisma.systemSetting.findFirst({ where: { type: KEY } });
  const u: Usage | null = row?.text ? (JSON.parse(row.text) as Usage) : null;

  // ضمان تصفير عند بداية شهر جديد لم يصله قياس بعد (نعرض 0 لا رقم الشهر الماضي)
  const nowMonth = new Date().toISOString().slice(0, 7);
  const fresh = u && u.month === nowMonth ? u : null;
  const requests = fresh?.requests ?? 0;
  const pct = (used: number, limit: number) => Math.round((used / limit) * 1000) / 10;

  return NextResponse.json({
    hasData: !!fresh,
    month: nowMonth,
    updatedAt: fresh?.updatedAt ?? null,
    grant: GRANT,
    requests: {
      used: requests,
      limit: GRANT.requests,
      freePct: pct(requests, GRANT.requests),
      remaining: Math.max(0, GRANT.requests - requests),
    },
    vcpuSeconds: fresh?.vcpuSeconds != null
      ? { used: fresh.vcpuSeconds, limit: GRANT.vcpuSeconds, freePct: pct(fresh.vcpuSeconds, GRANT.vcpuSeconds) }
      : null,
    gibSeconds: fresh?.gibSeconds != null
      ? { used: fresh.gibSeconds, limit: GRANT.gibSeconds, freePct: pct(fresh.gibSeconds, GRANT.gibSeconds) }
      : null,
  });
}
