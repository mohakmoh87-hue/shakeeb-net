import { prisma } from "./prisma";

// ===== إعدادات لكل وكيل (عزل المستأجر) =====
// المفتاح المعزول: "type:agentId" في system_settings. الارتداد للمفتاح القديم العام
// (type بلا لاحقة) للوكيل الأول (1) حصراً — قيمه ما قبل العزل ملكُه، فلا يتغير سلوكه،
// وأي وكيل آخر بلا قيمة محفوظة يأخذ الافتراضي المحايد (لا تسريب بين الوكلاء).
export async function getAgentSetting(
  type: string,
  agentId: number | null | undefined,
  fallback = "",
): Promise<string> {
  if (agentId != null) {
    const r = await prisma.systemSetting.findFirst({ where: { type: `${type}:${agentId}` } });
    if (r) return (r.value ?? r.text ?? "").trim() || fallback;
  }
  if (agentId === 1 || agentId == null) {
    const legacy = await prisma.systemSetting.findFirst({ where: { type } });
    if (legacy) return (legacy.value ?? legacy.text ?? "").trim() || fallback;
  }
  return fallback;
}

// كتابة قيمة إعدادٍ لوكيل: دائماً على المفتاح المعزول "type:agentId"
// (agentId فارغ — كالمالك — يكتب المفتاح القديم العام: قيم النظام الافتراضية)
export async function setAgentSetting(
  type: string,
  agentId: number | null | undefined,
  value: string,
): Promise<void> {
  const key = agentId != null ? `${type}:${agentId}` : type;
  const existing = await prisma.systemSetting.findFirst({ where: { type: key } });
  if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { value } });
  else await prisma.systemSetting.create({ data: { type: key, value } });
}
