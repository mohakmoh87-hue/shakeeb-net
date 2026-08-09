import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAny, agentTowerIds } from "@/lib/guard";
import { EVENT_TYPES, getEffectiveTemplate } from "@/lib/smsTemplates";

export const dynamic = "force-dynamic";

// ===== «القوالب الفعّالة» لقائمة اختيار الإرسال (طلب محمد 2026-08-09) =====
// قائمة القوالب في الإرسال كانت تقرأ صفوف القاعدة وحدها، فتظهر فارغةً/ناقصةً متى غاب صفٌّ
// (النظام يعتمد نصوصاً **افتراضيّة في الكود** عند غياب الصفّ). هذا المسار يُرجع ما يُرسَل فعلاً:
//   نصّ المكتب ← نصّ الوكيل ← النصّ الافتراضيّ،  زائداً القوالب الحرّة التي أنشأها المدير.
// العزل: الوكيل من الجلسة حصراً (agentId)؛ ومستخدم المكتب مُقيَّدٌ بمكتبه (لا يقرأ تخصيص
// مكتبٍ آخر ولو مرّر officeId)، والمدير يختار مكتباً من مكاتب وكيله بعد التصديق.
export async function GET(request: Request) {
  const g = await guardAny("templates.manage", "messaging.manage");
  if (g.error) return g.error;
  const session = g.session!;
  const agentId = session.agentId ?? null;

  // المكتب الفعّال (للتخصيصات)
  const isOfficeUser = !session.isAdmin && session.towerId != null;
  let officeId: number | null = null;
  if (isOfficeUser) {
    officeId = session.towerId!;
  } else {
    const req = Number(new URL(request.url).searchParams.get("officeId")) || 0;
    if (req > 0) {
      const towers = await agentTowerIds(session);
      officeId = towers.includes(req) ? req : null;
    }
  }

  const out: { key: string; type: string; text: string; scope: "office" | "agent" | "default" | "custom" }[] = [];

  // ١) قوالب الأحداث — بنصّها الفعّال (يشمل الافتراضيّ من الكود)
  for (const type of EVENT_TYPES) {
    const text = await getEffectiveTemplate(type, agentId, officeId);
    if (!text || !text.trim()) continue; // معطَّل أو بلا نصّ
    const own = officeId != null
      ? await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: officeId }, select: { text: true } })
      : null;
    const agentRow = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: null }, select: { text: true } });
    out.push({
      key: `e:${type}`, type, text,
      scope: own?.text?.trim() ? "office" : agentRow?.text?.trim() ? "agent" : "default",
    });
  }

  // ٢) القوالب الحرّة التي أنشأها المدير (أيّ نوعٍ ليس حدثاً ولا علامة زرع)
  const customs = await prisma.smsTemplate.findMany({
    where: {
      agentId: agentId ?? -1,
      NOT: { type: { startsWith: "__" } },
      type: { notIn: [...EVENT_TYPES] },
      ...(isOfficeUser ? { OR: [{ towerId: null }, { towerId: session.towerId! }] } : {}),
    },
    select: { id: true, type: true, text: true, towerId: true },
    orderBy: { id: "asc" },
  });
  for (const c of customs) {
    const t = (c.text ?? "").trim();
    if (t) out.push({ key: `c:${c.id}`, type: c.type ?? `قالب #${c.id}`, text: t, scope: "custom" });
  }

  return NextResponse.json({ templates: out, officeId });
}
