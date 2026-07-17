import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// المفاتيح المعروفة للإعدادات
const KNOWN = ["office", "dollar", "phone", "country", "whatsapp", "silent", "reminderTime", "reportTime", "backupTime"] as const;

const schema = z.object({
  office: z.string().nullable().optional(),
  dollar: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(), // 1 = تفعيل واتساب لكل المشتركين
  silent: z.string().nullable().optional(), // 1 = إرسال صامت افتراضي بلا تأكيد
  reminderTime: z.string().nullable().optional(), // وقت إرسال تذكير الانتهاء يومياً (HH:MM)
  reportTime: z.string().nullable().optional(), // وقت إرسال تقرير المدير يومياً (HH:MM)
  backupTime: z.string().nullable().optional(), // وقت إرسال النسخة الاحتياطية يومياً (HH:MM)
});

export async function GET() {
  const g = await guard("settings.manage");
  if (g.error) return g.error;

  const rows = await prisma.systemSetting.findMany({
    where: { type: { in: [...KNOWN] } },
  });
  const map: Record<string, string> = {};
  for (const r of rows) if (r.type) map[r.type] = r.value ?? "";
  return NextResponse.json(map);
}

export async function POST(request: Request) {
  const g = await guard("settings.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  for (const key of KNOWN) {
    const value = parsed.data[key];
    if (value === undefined) continue;
    const existing = await prisma.systemSetting.findFirst({ where: { type: key } });
    if (existing) {
      await prisma.systemSetting.update({
        where: { id: existing.id },
        data: { value: value ?? "" },
      });
    } else {
      await prisma.systemSetting.create({ data: { type: key, value: value ?? "" } });
    }
  }
  return NextResponse.json({ ok: true });
}
