import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny, agentTowerIds } from "@/lib/guard";
import { DEFAULT_TEMPLATES, EVENT_TYPES, SEED_MARK } from "@/lib/smsTemplates";
import type { SessionPayload } from "@/lib/auth";

// البند ٣ · سقفُ الصورة **على الخادم**: الواجهةُ تحرسه أيضاً، لكنّ حرسَ الواجهة يُتجاوَز
// بطلبٍ مباشر، والصفُّ يُقرأ في **كلّ إرسال** — فسقفٌ ضائعٌ هنا يُثقل كلّ رسالةٍ للأبد.
// ٤٠٠ ألف حرفٍ ≈ ٣٠٠ كيلوبايت ملفّاً أصليّاً بعد تضخيم base64 (٣٣٪).
const IMAGE_MAX_CHARS = 400_000;

const schema = z.object({
  templates: z.array(
    z.object({
      type: z.enum(EVENT_TYPES),
      text: z.string().default(""),
      enable: z.string().default("1"),
      reset: z.boolean().optional(), // مع مكتب محدّد: حذف تخصيص المكتب (العودة لقالب الوكيل العام)
      // 🖼️ صورةُ القالب (data URI). التمييزُ مقصود: **غيابُ الحقل** = لا تمسّ الصورةَ
      // المحفوظة، و**""** = احذفها. فلو كان الغيابُ حذفاً لَمَحا كلُّ حفظٍ من واجهةٍ
      // قديمةٍ صورةَ محمد بلا أن يطلب ذلك أحد.
      image: z.string().max(IMAGE_MAX_CHARS, "الصورة أكبر من المسموح (٣٠٠ كيلوبايت)").nullable().optional(),
    }),
  ),
  officeId: z.coerce.number().int().positive().nullable().optional(), // null/غياب = قوالب الوكيل العامة
});

// المكتب الفعّال للطلب (عزل): مستخدم المكتب مُقيَّد بمكتبه دوماً؛ المدير يختار مكتباً من
// مكاتب وكيله أو «عام» (null). يرجع undefined عند طلب مكتب لا يتبع الوكيل.
async function resolveOffice(session: SessionPayload, requested: number | null): Promise<number | null | undefined> {
  if (!session.isAdmin && session.towerId != null) return session.towerId; // موظف مكتب: مكتبه حصراً
  if (requested == null) return null;
  const towers = await agentTowerIds(session);
  return towers.includes(requested) ? requested : undefined;
}

// جلب قوالب الأحداث — عامة للوكيل أو مخصّصة لمكتب (?officeId=):
// مع مكتب: يُعرض قالب المكتب إن وُجد وإلا قالب الوكيل (مع علامة officeCustom للتمييز).
// (يزرع النصوص الافتراضية للوكيل مرة واحدة عند أول فتح — كما كان)
export async function GET(request: Request) {
  const g = await guardAny("templates.manage", "messaging.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const officeId = await resolveOffice(g.session!, reqOffice);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  // زرع النصوص الافتراضية (تفعيل/تذكير/تسديد دين) مرة واحدة — تستبدل المكتوب سابقاً
  // (بقرار صريح من المالك)، وصفّ العلامة يمنع تكرار الاستبدال فتبقى تعديلات المستخدم بعدها.
  const marker = await prisma.smsTemplate.findFirst({ where: { type: SEED_MARK, agentId: agentId ?? -1 } });
  if (!marker) {
    for (const [type, text] of Object.entries(DEFAULT_TEMPLATES)) {
      const existing = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: null } });
      if (existing) await prisma.smsTemplate.update({ where: { id: existing.id }, data: { text } });
      else await prisma.smsTemplate.create({ data: { type, text, enable: "1", agentId } });
    }
    await prisma.smsTemplate.create({ data: { type: SEED_MARK, text: "", enable: "1", agentId } });
  }

  // قوالب الوكيل العامة (towerId فارغ) + قوالب المكتب المطلوب إن حُدّد
  const agentRows = await prisma.smsTemplate.findMany({ where: { type: { in: [...EVENT_TYPES] }, agentId: agentId ?? -1, towerId: null } });
  const officeRows = officeId != null
    ? await prisma.smsTemplate.findMany({ where: { type: { in: [...EVENT_TYPES] }, agentId: agentId ?? -1, towerId: officeId } })
    : [];
  const agentMap = new Map(agentRows.map((r) => [r.type, r]));
  const officeMap = new Map(officeRows.map((r) => [r.type, r]));

  const result = EVENT_TYPES.map((cat) => {
    const o = officeId != null ? officeMap.get(cat) : undefined;
    const a = agentMap.get(cat);
    // 🖼️ الصورةُ تتبع سلَّم النصّ نفسَه لكنّها تسقط **مستقلّةً** — كما في getEffectiveTemplateFull:
    //   مكتبٌ له نصُّه وبلا صورةٍ يعرض (ويُرسل) صورةَ الوكيل. و`imageOwn` يُخبر الواجهةَ
    //   أنّ الصورةَ المعروضةَ موروثةٌ لا مملوكة، فلا يظهر زرُّ «حذف» لِما لا تملكه.
    const own = o ? (o.image?.trim() || null) : (a?.image?.trim() || null);
    const shown = own ?? (o ? (a?.image?.trim() || null) : null);
    if (o) return { type: cat, text: o.text ?? "", enable: o.enable ?? "1", officeCustom: true, image: shown, imageOwn: own != null };
    return { type: cat, text: a?.text ?? DEFAULT_TEMPLATES[cat] ?? "", enable: a?.enable ?? "1", officeCustom: false, image: shown, imageOwn: own != null };
  });
  return NextResponse.json({ templates: result, officeId });
}

// حفظ (upsert) قوالب الأحداث دفعة واحدة — عامة للوكيل أو مخصّصة لمكتب (officeId في الجسم).
// مع مكتب: reset=true لقالبٍ يحذف تخصيص المكتب فيعود لقالب الوكيل العام.
export async function POST(request: Request) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const agentId = g.session?.agentId ?? null; // عزل: قوالب وكيل المستخدم
  const officeId = await resolveOffice(g.session!, parsed.data.officeId ?? null);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  // هل لُمست صورةٌ في هذا الحفظ؟ — يُقرّر استرجاعَ المساحة في النهاية
  let imageTouched = false;
  for (const t of parsed.data.templates) {
    if (officeId != null && t.reset) {
      // العودة لقالب الوكيل العام: حذف صف تخصيص المكتب (حذفٌ صريحٌ لا ناعم — ومعه صورتُه)
      const gone = await prisma.smsTemplate.deleteMany({ where: { type: t.type, agentId: agentId ?? -1, towerId: officeId } });
      if (gone.count) imageTouched = true;
      continue;
    }
    const existing = await prisma.smsTemplate.findFirst({
      where: { type: t.type, agentId: agentId ?? -1, towerId: officeId ?? null },
    });
    if (existing) {
      // `image: undefined` تعني «لا تمسّها» في Prisma — وهو عينُ ما نريد للواجهات القديمة
      await prisma.smsTemplate.update({
        where: { id: existing.id },
        data: { text: t.text, enable: t.enable, ...(t.image === undefined ? {} : { image: t.image?.trim() || null }) },
      });
      if (t.image !== undefined) imageTouched = true;
    } else {
      await prisma.smsTemplate.create({ data: { type: t.type, text: t.text, enable: t.enable, image: t.image?.trim() || null, agentId, towerId: officeId ?? null } });
    }
  }
  // ═════ 🔒 القفلُ المتبادل مع «تذكير الانتهاء حسب الباقة» (طلبُ محمد 2026-08-21) ═════
  // «تفعيلُ أحدِهما يُلغي تفعيلَ الآخرِ تلقائيّاً — لا يجتمعان أبداً». والحرسُ هنا
  // **على الخادم** لا في الواجهة: ضغطتان متزامنتان أو طلبٌ مباشرٌ لا يكسرانه.
  // ولا يمسّ شيئاً آخرَ: لا يعمل إلّا إن كان `expiring` ضمنَ ما حُفظ في هذا الطلب.
  const expTouched = parsed.data.templates.find((t) => t.type === "expiring" && !t.reset);
  if (expTouched && expTouched.enable === "1") {
    const { EXPIRING_BY_PKG } = await import("@/lib/smsTemplates");
    const row = await prisma.smsTemplate.findFirst({
      where: { type: EXPIRING_BY_PKG, agentId: agentId ?? -1, towerId: officeId ?? null },
    });
    if (row) await prisma.smsTemplate.update({ where: { id: row.id }, data: { enable: "0" } });
  }

  // ═════ 🧹 «تُحذف الصورةُ القديمة نهائياً» (طلبُ محمد 2026-08-13) ═════
  // تبديلُ الصورة `UPDATE` يجعل القديمةَ **بلا مرجع** — لكنّها **لا تزول من القرص**:
  // بوستغرس يُبقي الصفَّ الميّتَ وقطعَ TOAST القديمة حتى يمرّ عليها الـvacuum. فصورةٌ
  // بُدّلت عشرَ مرّاتٍ تُخلّف عشرَ نسخٍ محجوزةً على القرص — وهي بعينها ما «تُغلي الفاتورة».
  // ⇒ فالاسترجاعُ فوريٌّ عند لمسِ صورةٍ (والجدولُ ٧٤ صفّاً فالكلفةُ لا تُذكَر).
  // 🔑 وهو **أفضل جهدٍ لا شرطُ نجاح**: VACUUM يحتاج ملكيّةَ الجدول، ودورُ العامل ليس
  //   المالك — فلو فشل، القاعدةُ سليمةٌ والاسترجاعُ يتمّ بالـautovacuum لاحقاً. ولا
  //   يجوز أن يُفشل حفظَ محمد لأجل تنظيفٍ تجميليّ.
  if (imageTouched) {
    await prisma.$executeRawUnsafe("VACUUM (ANALYZE) sms_templates").catch((e: unknown) => {
      console.warn("[templates] تعذّر استرجاعُ مساحة الصور فوراً — يتولّاها autovacuum:", e instanceof Error ? e.message : e);
    });
  }
  // ═════ 🧹 «تُحذف الصورةُ القديمة نهائياً» (طلبُ محمد 2026-08-13) ═════
  // تبديلُ الصورة `UPDATE` يجعل القديمةَ **بلا مرجع** — لكنّها **لا تزول من القرص**:
  // بوستغرس يُبقي الصفَّ الميّتَ وقطعَ TOAST القديمة حتى يمرّ عليها الـvacuum. فصورةٌ
  // بُدّلت عشرَ مرّاتٍ تُخلّف عشرَ نسخٍ محجوزةً على القرص — وهي بعينها ما «يُغلي الفاتورة».
  // ⇒ فالاسترجاعُ فوريٌّ عند لمسِ صورةٍ (والجدولُ ٧٤ صفّاً فالكلفةُ لا تُذكَر).
  // 🔑 وهو **أفضل جهدٍ لا شرطُ نجاح**: VACUUM يحتاج ملكيّةَ الجدول، ودورُ العامل ليس
  //   المالك — فلو فشل، القاعدةُ سليمةٌ والاسترجاعُ يتمّ بالـautovacuum لاحقاً. ولا
  //   يجوز أن يُفشل حفظَ محمد لأجل تنظيفٍ تجميليّ.
  if (imageTouched) {
    await prisma.$executeRawUnsafe("VACUUM (ANALYZE) sms_templates").catch((e: unknown) => {
      console.warn("[templates] تعذّر استرجاعُ مساحة الصور فوراً — يتولّاها autovacuum:", e instanceof Error ? e.message : e);
    });
  }
  return NextResponse.json({ ok: true });
}
