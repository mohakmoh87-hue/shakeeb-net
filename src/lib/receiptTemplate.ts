import { prisma } from "@/lib/prisma";

export type ReceiptTemplate = {
  headerText: string;
  footerText: string;
  logo: string;
  fontColor: string;
  bgColor: string;
  headerColor: string;
  fontSize: number;
  showLogo: boolean;
};

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

// قراءة قالب الوصل المخزّن (server-side) للاستخدام في صفحات الطباعة
// قالب الوصل لوكيل محدّد (عزل المستأجر): مفتاح الوكيل، ثم ارتداد للمفتاح القديم "receipt"
export async function getReceiptTemplate(agentId?: number | null): Promise<ReceiptTemplate> {
  let row = agentId != null
    ? await prisma.systemSetting.findFirst({ where: { type: `receipt:${agentId}` } })
    : null;
  if (!row) row = await prisma.systemSetting.findFirst({ where: { type: "receipt" } });
  if (row?.text) {
    try { return { ...DEFAULT_RECEIPT, ...JSON.parse(row.text) }; } catch { /* ignore */ }
  }
  return DEFAULT_RECEIPT;
}
