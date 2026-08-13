import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";

const schema = z.object({
  name: z.string().min(1, "اسم المكتب مطلوب"),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  loginUrl: z.string().nullable().optional(),
  activationTemplate: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
  nesba: z.coerce.number().nullable().optional(),
  groupId: z.coerce.number().nullable().optional(),
  activationMode: z.enum(["month", "days30"]).nullable().optional(), // نظام التفعيل
  managerPhone: z.string().nullable().optional(), // رقم مدير المكتب
  mapArea: z.string().nullable().optional(), // رمز منطقة الخريطة
  rewardsEnabled: z.string().nullable().optional(), // 1 = تفعيل نظام المكافآت للمكتب
  silent: z.string().nullable().optional(), // 1 = إرسال صامت
  waEnabled: z.string().nullable().optional(), // 1 = تفعيل واتساب المكتب
  syncTime: z.string().nullable().optional(), // وقت مزامنة الاشتراكات اليومية (HH:MM)
  syncEnabled: z.string().nullable().optional(), // 1 = تفعيل المزامنة التلقائية
  debtReminderEnabled: z.string().nullable().optional(), // 1 = رسائل ديون يومية
  debtReminderTime: z.string().nullable().optional(), // وقت رسائل الديون (HH:MM) — فارغ = يتبع reminderTime
  autoAssignEnabled: z.boolean().optional(), // توزيع البطاقات تلقائياً على فنيي هذا المكتب
  reminderTime: z.string().nullable().optional(), // وقت تذكير الانتهاء الخاص بهذا المكتب (HH:MM)
  reminderDays: z.coerce.number().int().min(1).max(60).nullable().optional(), // أيام تذكير الانتهاء — فارغ = يومان
  // موقع المكتب للبصمة الجغرافية
  lat: z.coerce.number().nullable().optional(),
  lng: z.coerce.number().nullable().optional(),
  geoRadius: z.coerce.number().int().min(20).max(5000).nullable().optional(),
  geoEnabled: z.boolean().optional(),
  loanEnabled: z.string().nullable().optional(), // 1 = تفعيل قروض سوبر سيل (مدير فقط)
  loanUser: z.string().nullable().optional(), // اسم مستخدم قروض سوبر سيل (مدير فقط)
  loanPass: z.string().nullable().optional(), // كلمة مرور القروض — تُشفَّر (مدير فقط)
  loanMode: z.string().nullable().optional(), // activation | normal (طريقة القرض، مدير فقط)
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.edit");
  if (g.error) return g.error;

  const { id } = await params;
  // عزل المستأجر: لا يُعدَّل إلا مكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, Number(id)))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  // حالة القرض قبل التعديل — لكشف تحويل الإطفاء→تشغيل (فحص إعادة التشغيل)
  const before = g.session?.isAdmin
    ? await prisma.tower.findUnique({ where: { id: Number(id) }, select: { loanEnabled: true } })
    : null;
  // 🔴 قيمُ الساس **قبل** التعديل — تلزم المرآةَ أدناه كي تنسخ ما **تغيّر فعلاً** لا ما أُرسل
  const prevSas = await prisma.tower.findUnique({
    where: { id: Number(id) },
    select: { loginUrl: true, username: true, password: true, activationTemplate: true },
  });

  // إعداد القرض للمدير حصراً. loanPass يُشفَّر؛ والفراغ لا يمحو القديم (يُحفظ لإعادة التفعيل).
  const data = { ...parsed.data };
  if (!g.session?.isAdmin) {
    // غير المدير لا يعدّل إعداد القرض إطلاقاً
    delete data.loanEnabled; delete data.loanUser; delete data.loanPass; delete data.loanMode;
  } else if (data.loanPass == null || data.loanPass === "") {
    delete data.loanPass; // فارغ = أبقِ القديم
  } else {
    data.loanPass = encryptSecret(data.loanPass);
  }
  const updated = await prisma.tower.update({
    where: { id: Number(id) },
    data,
  });

  // ═════ أ-٢٣ · تعديلُ ساس المكتب يُحدِّث **لوحتَه الأولى** معه (قرار محمد 2026-08-13) ═════
  // 🔴 والسببُ حادثةٌ مقيسة: رابطُ ساس صميم كان مكتوباً في موضعَين مختلفَين —
  //    اللوحةُ الأولى `reseller.scn-ftth.com` وعمودُ المكتب `82.129.22.22` — والمستخدمُ
  //    متطابقٌ فيهما، أي أنّ تعديلاً على صفحة المكاتب ذهب إلى العمود ولم يمسّ اللوحة.
  //    ومشتركوه كلُّهم موسومون بلوحةٍ ⇒ اللوحةُ هي العاملةُ، والعمودُ نائمٌ **حتى يُنشأ مشتركٌ
  //    بلا وسمٍ فيسقط إليه ⇒ تفعيلٌ على مُخدِّمٍ خطأ بلا أن يُنبَّه أحد**.
  //
  // ⚠️ واللوحةُ **الأولى وحدَها** (`isPrimary`): فاللوحاتُ الأخرى مُخدِّماتٌ مستقلّةٌ بروابطَ
  //    مختلفة — «يمكن أن يكون لوكيلٍ صفحتان للساس برابطَين يختلفان» (نصُّ محمد) — فمسُّها
  //    يُخرِّب عملَها. وتُنسَخ **الحقولُ المُرسَلةُ وحدَها** فلا يُفرَّغ ما لم يُعدَّل.
  //    وكلمةُ المرور الفارغةُ **لا تُنسَخ**: طمسُ كلمةِ لوحةٍ عاملةٍ يوقف التفعيلَ عليها،
  //    والفراغُ في نموذجٍ لم يُعَد كتابتُه أكثرُ احتمالاً من نيّةِ المحو.
  // 🔴 **علّةٌ اصطادها تدقيقٌ عدائيٌّ في مرآةٍ أضفتُها قبل ساعة**: كانت تنسخ **كلَّ حقلٍ
  // مُرسَلٍ** لا كلَّ حقلٍ **تغيّر**. ونموذجُ المكتب يُرسل حقولَه كاملةً في كلّ حفظ ⇒ فمَن
  // يُعدّل اسمَ المكتب وحدَه كان **يطمس رابطَ لوحته العاملَ** بقيمة العمود القديمة.
  // وهو عينُ ما كان سيقع لصميم: العمودُ كان يحمل رابطاً قديماً واللوحةُ الرابطَ العامل.
  // ⇒ لا يُنسَخ إلّا ما **اختلف عن قيمته السابقة** — فحفظٌ لا يُغيّر الساسَ لا يمسّ اللوحة.
  const changed = (k: "loginUrl" | "username" | "activationTemplate") =>
    k in parsed.data && (parsed.data[k] ?? null) !== (prevSas?.[k] ?? null);
  const sasMirror: Record<string, string | null> = {};
  if (changed("loginUrl")) sasMirror.loginUrl = parsed.data.loginUrl ?? null;
  if (changed("username")) sasMirror.username = parsed.data.username ?? null;
  if (changed("activationTemplate")) sasMirror.activationTemplate = parsed.data.activationTemplate ?? null;
  // وكلمةُ المرور: تُنسَخ إن أُرسلت **واختلفت** — والفارغةُ لا تُنسَخ أبداً (لا تُطمَس عاملةٌ)
  if (parsed.data.password && parsed.data.password !== (prevSas?.password ?? null)) sasMirror.password = parsed.data.password;
  if (Object.keys(sasMirror).length) {
    // `updateMany` لا `update`: مكتبٌ بلا لوحةٍ أولى (لم تُنشأ له لوحاتٌ بعدُ) لا يُخطئ
    await prisma.sasPanel.updateMany({
      where: { towerId: Number(id), isPrimary: true, isDeleted: false },
      data: sasMirror,
    }).catch(() => {}); // ولا يُفشِل تعديلَ المكتب أبداً — المرآةُ زينةٌ لا شرط
  }

  // فحص إعادة التشغيل (طلب محمد): عند تحويل القرض من إطفاء→تشغيل، امسح ديون مَن فُعِّل عاديّاً
  // منذ منح قرضه (لأنه سدّد فعليّاً). عزل صارم: مقيَّد بمكتب هذا الـid المُتحقَّق ملكيّته؛ لا
  // يمسّ مكتباً/وكيلاً آخر. عددها قليل (قروض مكتبٍ واحد) فالحلقة مقبولة.
  if (g.session?.isAdmin && data.loanEnabled === "1" && before?.loanEnabled !== "1") {
    const debts = await prisma.loanDebt.findMany({
      where: { towerId: Number(id), isDeleted: false },
      select: { id: true, subscriberId: true, grantDate: true },
    });
    for (const d of debts) {
      const activated = await prisma.subscriptionEntry.findFirst({
        where: { subscriberId: d.subscriberId, isDeleted: false, moneyType: 1, date: { gt: d.grantDate } },
        select: { id: true },
      });
      if (activated) await prisma.loanDebt.delete({ where: { id: d.id } });
    }
  }
  // تعقيم الردّ كـ GET: بيانات القرض للمدير حصراً — يراها مفكوكةً؛ غيره لا يراها إطلاقاً.
  // (كان الردّ يُعيد الصفّ خاماً فيسرّب loanUser/loanPass لمستخدم مكتبٍ يملك offices.edit.)
  const row: Record<string, unknown> = { ...updated };
  if (g.session?.isAdmin) row.loanPass = decryptSecret(updated.loanPass);
  else { delete row.loanUser; delete row.loanPass; }
  delete row.odooPass; // أودو نصٌّ صريح — لا يُعاد أبداً
  return NextResponse.json(row);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.delete");
  if (g.error) return g.error;

  const { id } = await params;
  // عزل المستأجر: لا يُحذف إلا مكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, Number(id)))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }
  await prisma.tower.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
