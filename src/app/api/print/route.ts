import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// إنشاء أمر طباعة صامتة: يلتقطه العامل المحلي بحاسبة المكتب فيطبع الوصل فوراً
// على الطابعة الافتراضية بلا أي نافذة — من أي جهاز (هاتف/متصفح/تطبيق).
const schema = z.object({
  kind: z.enum(["subscription", "invoice"]),
  id: z.coerce.number().int().positive(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const { kind, id } = parsed.data;

  // مكتب الوصل (وجهة الطباعة) + عزل الوكيل
  let towerId: number | null = null;
  if (kind === "subscription") {
    const entry = await prisma.subscriptionEntry.findUnique({ where: { id }, select: { towerId: true } });
    if (!entry) return NextResponse.json({ error: "الوصل غير موجود" }, { status: 404 });
    towerId = entry.towerId;
  } else {
    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { towerId: true } });
    if (!invoice) return NextResponse.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    towerId = invoice.towerId;
  }
  if (towerId != null && !(await ownsTower(session, towerId))) {
    return NextResponse.json({ error: "الوصل لا يتبع حسابك" }, { status: 403 });
  }

  // منع الازدواج: أمر حديث (أقل من 20 ثانية) لنفس الوصل يُعاد بدل إنشاء ثانٍ
  // (يحمي من التحديث المتكرر للصفحة أو النقر المزدوج)
  const recent = await prisma.printJob.findFirst({
    where: { kind, refId: id, createdAt: { gte: new Date(Date.now() - 20_000) } },
    orderBy: { id: "desc" },
  });
  const job = recent ?? await prisma.printJob.create({
    data: { agentId: session.agentId, towerId, kind, refId: id },
  });

  // حالة العامل: نبضة حديثة (٩٠ ثانية) لأي حاسبة معتمدة لهذا الوكيل = الطابعة جاهزة
  const worker = await prisma.hybridWorker.findFirst({
    where: {
      agentId: session.agentId ?? -1,
      approved: true,
      blocked: false,
      lastSeen: { gte: new Date(Date.now() - 90_000) },
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, jobId: job.id, deduped: !!recent, workerOnline: !!worker }, { status: recent ? 200 : 201 });
}

// حالة أمر طباعة (لعرض «تمت الطباعة/فشلت» في الواجهة)
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const jobId = Number(new URL(request.url).searchParams.get("jobId"));
  if (!jobId) return NextResponse.json({ error: "jobId مطلوب" }, { status: 400 });
  const job = await prisma.printJob.findFirst({
    where: { id: jobId, agentId: session.agentId },
    select: { status: true, error: true },
  });
  if (!job) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  return NextResponse.json(job);
}
