import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ═════ مُبلّغُ أخطاء الواجهة (طلبُ محمد 2026-08-19: «أن يُبلّغ البرنامجُ عن نفسه») ═════
//
// الفحصُ الشاملُ مهما بلغ لا يضمن الصفر — فالفارقُ الحقيقيُّ سرعةُ اكتشاف العطل.
// كان انهيارُ صفحةٍ في متصفّح مستخدمٍ يضيع بلا أثر: لا هو يصفه بدقّة ولا نحن نراه،
// وتشخيصُ «اكو خلل» يبدأ من الصفر كلَّ مرّة. الآن كلُّ خطأٍ غيرِ ملتقَطٍ في أيّ
// متصفّحٍ يُسجَّل هنا بسطره وصفحته وصاحبه — فيُقرأ من صفحة سجلّ التدقيق مباشرة.
//
// 🛡️ حارسان ضدّ إغراق السجلّ:
//   · حدٌّ في المتصفح (٥ لكلّ جلسة صفحة) + حدٌّ هنا: نفسُ (المستخدم+الرسالة) لا يُكتب
//     أكثر من مرّة كلّ ٥ دقائق — فخطأٌ في حلقةِ رسمٍ لا يكتب آلاف الصفوف.
//   · والأحجامُ مقصوصة، فالسجلُّ لا يتضخّم بمكدّسٍ عملاق.
const schema = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(2000).optional(),
  page: z.string().max(300).optional(),
  kind: z.enum(["error", "unhandledrejection"]).default("error"),
});

// مانعُ التكرار في ذاكرة العمليّة — يكفي: الهدفُ كبحُ الإغراق لا عدٌّ دقيق
const seen = new Map<string, number>();
const WINDOW_MS = 5 * 60_000;

export async function POST(request: Request) {
  // مستخدمٌ أو فنيّ — وغيرُ المسجَّل يُرفض (لا نفتح باباً للكتابة المجهولة)
  const session = await getSession();
  const tech = session ? null : await getTechSession();
  if (!session && !tech) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const d = parsed.data;

  const who = session ? `user:${session.userId}` : `tech:${tech!.technicianId}`;
  const key = `${who}|${d.message.slice(0, 120)}`;
  const now = Date.now();
  const last = seen.get(key) ?? 0;
  if (now - last < WINDOW_MS) return NextResponse.json({ ok: true, throttled: true });
  seen.set(key, now);
  // تنظيفٌ كسول كي لا تنمو الخريطة بلا حدّ
  if (seen.size > 500) for (const [k, t] of seen) if (now - t > WINDOW_MS) seen.delete(k);

  await prisma.auditLog.create({
    data: {
      userId: session?.userId ?? null,
      action: "CLIENT_ERROR",
      entity: d.kind,
      details:
        `${session ? session.username : `فنيّ #${tech!.technicianId}`} · ${d.page ?? "؟"}\n` +
        `${d.message}` + (d.stack ? `\n${d.stack.split("\n").slice(0, 6).join("\n")}` : ""),
    },
  }).catch(() => { /* المُبلّغ لا يُنشئ أخطاءً هو نفسُه */ });
  return NextResponse.json({ ok: true });
}
