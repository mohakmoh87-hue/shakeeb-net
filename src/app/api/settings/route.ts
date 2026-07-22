import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/guard";
import { getAgentSetting, setAgentSetting } from "@/lib/agentSettings";

// المفاتيح المعروفة للإعدادات
const KNOWN = ["office", "dollar", "country", "whatsapp", "silent", "reminderTime", "reportTime", "backupTime"] as const;

const schema = z.object({
  office: z.string().nullable().optional(),
  dollar: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(), // 1 = تفعيل واتساب لكل المشتركين
  silent: z.string().nullable().optional(), // 1 = إرسال صامت افتراضي بلا تأكيد
  reminderTime: z.string().nullable().optional(), // وقت إرسال تذكير الانتهاء يومياً (HH:MM)
  reportTime: z.string().nullable().optional(), // وقت إرسال تقرير المدير يومياً (HH:MM)
  backupTime: z.string().nullable().optional(), // وقت إرسال النسخة الاحتياطية يومياً (HH:MM)
});

// عزل الوكلاء: كل وكيل يقرأ ويكتب قيمه هو فقط (مفاتيح "key:agentId")؛
// الوكيل الأول يرث قيمه القديمة من المفاتيح العامة تلقائياً (getAgentSetting)
export async function GET() {
  const g = await guard("settings.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;

  const map: Record<string, string> = {};
  for (const key of KNOWN) map[key] = await getAgentSetting(key, agentId, "");
  return NextResponse.json(map);
}

export async function POST(request: Request) {
  const g = await guard("settings.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  for (const key of KNOWN) {
    const value = parsed.data[key];
    if (value === undefined) continue;
    // الكتابة على مفتاح الوكيل المعزول حصراً — لا يلمس قيم بقية الوكلاء أبداً
    await setAgentSetting(key, agentId, value ?? "");
  }
  return NextResponse.json({ ok: true });
}
