import { prisma } from "@/lib/prisma";
import { resolveDims, resolveFields, resolveOrder, DEFAULT_ORDER, type ReceiptFields, type ReceiptBodyKey } from "@/lib/receiptPaper";

export type ReceiptTemplate = {
  headerText: string;
  footerText: string;
  logo: string;
  fontColor: string;
  bgColor: string;
  headerColor: string;
  fontSize: number;
  showLogo: boolean;
  // أبعاد ورق الطابعة (يدويّة، بالمليمتر). paperH=0 ⇒ لفّة حراريّة (طول تلقائيّ).
  paperW: number;
  paperH: number;
  contentW: number;
  fields: ReceiptFields; // أيّ معلومةٍ تظهر في الوصل
  fieldOrder: ReceiptBodyKey[]; // ترتيب صفوف الجسم (إعادة الترتيب بالسحب)
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
  paperW: 80,
  paperH: 0,
  contentW: 68,
  fields: resolveFields(null),
  fieldOrder: DEFAULT_ORDER,
};

// مفتاح قالب وصل مكتب محدّد (يغلب قالب الوكيل العام)
export function receiptOfficeKey(agentId: number, towerId: number): string {
  return `receipt:${agentId}:o${towerId}`;
}

// قراءة قالب الوصل المخزّن (server-side) للاستخدام في صفحات الطباعة.
// الترتيب: قالب المكتب المخصّص (إن مُرّر towerId ووُجد) ← قالب الوكيل العام ← المفتاح
// القديم "receipt" (للوكيل الأول حصراً) ← الافتراضي المحايد.
export async function getReceiptTemplate(agentId?: number | null, towerId?: number | null): Promise<ReceiptTemplate> {
  let row = agentId != null && towerId != null
    ? await prisma.systemSetting.findFirst({ where: { type: receiptOfficeKey(agentId, towerId) } })
    : null;
  if (!row && agentId != null) row = await prisma.systemSetting.findFirst({ where: { type: `receipt:${agentId}` } });
  // الارتداد للمفتاح القديم "receipt" للوكيل الأول (1) حصراً — قالبه ما قبل العزل؛
  // غيره يأخذ الافتراضي المحايد (سدّ تسريب شعار/ترويسة الوكيل الأول لوكلاء جدد)
  if (!row && agentId === 1) row = await prisma.systemSetting.findFirst({ where: { type: "receipt" } });
  if (row?.text) {
    try {
      const raw = { ...DEFAULT_RECEIPT, ...JSON.parse(row.text) };
      // حلّ الأبعاد (مع ترحيل النوع القديم paper) والحقول والترتيب — فلا يختفي حقلٌ ولا بُعد
      const d = resolveDims(raw as { paperW?: number; paperH?: number; contentW?: number; paper?: string });
      return {
        ...raw,
        paperW: d.paperW, paperH: d.paperH, contentW: d.contentW,
        fields: resolveFields((raw as { fields?: Record<string, boolean> }).fields),
        fieldOrder: resolveOrder((raw as { fieldOrder?: string[] }).fieldOrder),
      };
    } catch { /* ignore */ }
  }
  return DEFAULT_RECEIPT;
}
