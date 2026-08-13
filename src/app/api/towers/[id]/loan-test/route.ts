import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { decryptSecret } from "@/lib/secretbox";
import { testLoanConnection } from "@/lib/supercellLoan";

// اختبار اتصال قروض سوبر سيل لمكتب — للمدير حصراً، بلا أيّ منح.
// يقبل بيانات النموذج الحاليّة (قد لا تكون محفوظة بعد)؛ وإن غابت كلمة المرور يستعمل المخزّنة.
const schema = z.object({
  loanUser: z.string().nullable().optional(),
  loanPass: z.string().nullable().optional(),
  // لوحةُ الساس المطلوب اختبارُ حسابِ ديلرها — غيابُها = أعمدةُ المكتب (السلوكُ القديم)
  panelId: z.coerce.number().int().positive().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("offices.edit");
  if (g.error) return g.error;
  if (!g.session?.isAdmin) return NextResponse.json({ error: "إعداد القرض للمدير حصراً" }, { status: 403 });

  const { id } = await params;
  const towerId = Number(id);
  if (!(await ownsTower(g.session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  // ═════ الاختبارُ يتبع اللوحةَ أيضاً (طلبُ محمد: «الديلرَ بلا مشاكل») ═════
  // 🔴 كان يقرأ حسابَ **المكتب** وحدَه — ولو تركناه كذلك لَتكرّرت علّةُ الساس حرفيّاً:
  //   يضبط محمدٌ حسابَ ديلرِ اللوحة الثانية ثمّ يضغط «اختبار» فيُختبَر حسابُ الأولى
  //   فيقول «✓ يعمل»، فيطمئنّ ثمّ يفشل المنحُ عند أوّل مشترك.
  // 🔴 **وعلّةٌ ثانيةٌ في العيّنة**: كان يأخذ مشتركاً من **أيّ** لوحةٍ في المكتب. فحسابُ
  //   ديلرِ اللوحة الثانية يُختبَر على مشتركِ الأولى ⇒ سوبر سيل ترفضه بحقّ، فيُقال
  //   «الحسابُ خطأ» وهو صحيح. **فالعيّنةُ من لوحتها أو لا عيّنة.**
  const panelId = parsed.data.panelId ?? null;
  let stored: { loanUser: string | null; loanPass: string | null } | null = null;
  if (panelId != null) {
    // 🔒 العزل: اللوحةُ يجب أن تكون لهذا المكتب — والمكتبُ فُحص أعلاه بحارس الملكيّة
    stored = await prisma.sasPanel.findFirst({
      where: { id: panelId, towerId, isDeleted: false },
      select: { loanUser: true, loanPass: true },
    });
    if (!stored) return NextResponse.json({ ok: false, message: "اللوحة لا تتبع هذا المكتب" });
  } else {
    stored = await prisma.tower.findUnique({ where: { id: towerId }, select: { loanUser: true, loanPass: true } });
  }
  const loanUser = (parsed.data.loanUser ?? stored?.loanUser ?? "").trim();
  // كلمة المرور: المُدخلة إن وُجدت، وإلا المخزّنة (مفكوكة)
  const loanPass = parsed.data.loanPass && parsed.data.loanPass !== ""
    ? parsed.data.loanPass
    : (decryptSecret(stored?.loanPass) ?? "");
  if (!loanUser || !loanPass) {
    return NextResponse.json({ ok: false, message: "أدخل اسم المستخدم وكلمة المرور أولاً" });
  }

  // عيّنةُ مشتركٍ **من اللوحة نفسِها** (له sasId) لاختبار المسار كاملاً
  const sample = await prisma.subscriber.findFirst({
    where: { towerId, isDeleted: false, sasId: { not: null }, ...(panelId != null ? { sasPanelId: panelId } : {}) },
    select: { sasId: true },
    orderBy: { id: "desc" },
  });

  const res = await testLoanConnection({ loanUser, loanPass, sampleSasId: sample?.sasId ?? null });
  return NextResponse.json({
    ...res,
    // يُقال صريحاً **أيُّ حسابٍ** اختُبر وعلى **أيّ مشترك** — فاختبارٌ لا يُسمّي ما اختبره
    // هو ما جعل علّةَ الساس تمرّ صامتةً أسبوعاً.
    testedUser: loanUser,
    scope: panelId != null ? `لوحة #${panelId}` : "أعمدة المكتب",
    sampleFrom: sample ? (panelId != null ? "من اللوحة نفسِها" : "من المكتب") : "لا عيّنة",
  });
}
