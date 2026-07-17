import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

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

// مفتاح قالب الوصل لكل وكيل (عزل المستأجر)
function receiptKey(agentId: number | null | undefined) { return `receipt:${agentId ?? 0}`; }

export async function GET() {
  const g = await guard("receipt.template");
  if (g.error) return g.error;
  const key = receiptKey(g.session?.agentId);
  // مفتاح الوكيل، ثم ارتداد للمفتاح القديم "receipt" (توافق مع الوكيل الأول)
  let row = await prisma.systemSetting.findFirst({ where: { type: key } });
  if (!row) row = await prisma.systemSetting.findFirst({ where: { type: "receipt" } });
  let data = DEFAULT_RECEIPT;
  if (row?.text) {
    try { data = { ...DEFAULT_RECEIPT, ...JSON.parse(row.text) }; } catch { /* keep default */ }
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const g = await guard("receipt.template");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }
  const json = JSON.stringify(parsed.data);
  const key = receiptKey(g.session?.agentId);
  const existing = await prisma.systemSetting.findFirst({ where: { type: key } });
  if (existing) {
    await prisma.systemSetting.update({ where: { id: existing.id }, data: { text: json } });
  } else {
    await prisma.systemSetting.create({ data: { type: key, text: json } });
  }
  return NextResponse.json({ ok: true });
}
