import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import type { SessionPayload } from "@/lib/auth";

// قالب الوصل المطبوع (#13) — يُخزَّن كـ JSON في system_settings (type=receipt)
const schema = z.object({
  headerText: z.string().default(""),
  footerText: z.string().default(""),
  logo: z.string().default(""), // صورة data-url أو رابط
  fontColor: z.string().default("#1e293b"),
  bgColor: z.string().default("#ffffff"),
  headerColor: z.string().default("#1e66c9"),
  fontSize: z.coerce.number().default(14),
  showLogo: z.boolean().default(true),
});

export type ReceiptTemplate = z.infer<typeof schema>;

export const DEFAULT_RECEIPT: ReceiptTemplate = {
  headerText: "",
  footerText: "شكراً لاشتراككم",
  logo: "",
  fontColor: "#1e293b",
  bgColor: "#ffffff",
  headerColor: "#1e66c9",
  fontSize: 14,
  showLogo: true,
};

// مفتاح قالب الوصل لكل وكيل (عزل المستأجر) — ومفتاح مكتبٍ محدّد يغلب مفتاح الوكيل
function receiptKey(agentId: number | null | undefined) { return `receipt:${agentId ?? 0}`; }
function officeKey(agentId: number | null | undefined, towerId: number) { return `receipt:${agentId ?? 0}:o${towerId}`; }

// المكتب الفعّال للطلب (عزل): موظف المكتب مُقيَّد بمكتبه؛ المدير يختار مكتباً من مكاتب
// وكيله أو «عام» (null). undefined = مكتب لا يتبع الوكيل.
async function resolveOffice(session: SessionPayload, requested: number | null): Promise<number | null | undefined> {
  if (!session.isAdmin && session.towerId != null) return session.towerId;
  if (requested == null) return null;
  const towers = await agentTowerIds(session);
  return towers.includes(requested) ? requested : undefined;
}

export async function GET(request: Request) {
  const g = await guard("receipt.template");
  if (g.error) return g.error;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const officeId = await resolveOffice(g.session!, reqOffice);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  // قالب المكتب المخصّص إن طُلب مكتب ووُجد، ثم مفتاح الوكيل، ثم ارتداد للمفتاح القديم
  // "receipt" — للوكيل الأول (1) حصراً: القالب القديم ملكه (ما قبل العزل)، وأي وكيل
  // آخر بلا قالب يأخذ الافتراضي المحايد
  const oRow = officeId != null ? await prisma.systemSetting.findFirst({ where: { type: officeKey(g.session?.agentId, officeId) } }) : null;
  let row = oRow ?? (await prisma.systemSetting.findFirst({ where: { type: receiptKey(g.session?.agentId) } }));
  if (!row && g.session?.agentId === 1) row = await prisma.systemSetting.findFirst({ where: { type: "receipt" } });
  let data = DEFAULT_RECEIPT;
  if (row?.text) {
    try { data = { ...DEFAULT_RECEIPT, ...JSON.parse(row.text) }; } catch { /* keep default */ }
  }
  return NextResponse.json({ ...data, officeCustom: !!oRow, officeId });
}

export async function POST(request: Request) {
  const g = await guard("receipt.template");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }
  const reqOffice = Number((body as { officeId?: number })?.officeId) || null;
  const officeId = await resolveOffice(g.session!, reqOffice);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const json = JSON.stringify(parsed.data);
  const key = officeId != null ? officeKey(g.session?.agentId, officeId) : receiptKey(g.session?.agentId);
  const existing = await prisma.systemSetting.findFirst({ where: { type: key } });
  if (existing) {
    await prisma.systemSetting.update({ where: { id: existing.id }, data: { text: json } });
  } else {
    await prisma.systemSetting.create({ data: { type: key, text: json } });
  }
  return NextResponse.json({ ok: true });
}

// حذف تخصيص مكتب (العودة لقالب الوكيل العام) — ?officeId= إلزامي
export async function DELETE(request: Request) {
  const g = await guard("receipt.template");
  if (g.error) return g.error;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const officeId = await resolveOffice(g.session!, reqOffice);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  if (officeId == null) return NextResponse.json({ error: "officeId مطلوب" }, { status: 400 });
  await prisma.systemSetting.deleteMany({ where: { type: officeKey(g.session?.agentId, officeId) } });
  return NextResponse.json({ ok: true });
}
