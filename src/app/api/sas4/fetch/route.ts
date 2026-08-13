import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasFetchOnePage } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { credsOfPanel, credsOfTower } from "@/lib/sasPanel";

const schema = z.object({
  towerId: z.coerce.number(),
  page: z.coerce.number().min(1).default(1),
  count: z.coerce.number().min(1).max(500).default(50), // حجم الصفحة (كما في SAS4)
  // أ-٢٣ · اللوحةُ المطلوبُ الجلبُ منها. فارغةٌ = أعمدةُ المكتب (السلوكُ القديم حرفيّاً)
  panelId: z.coerce.number().optional(),
});

// تسجيل الدخول تلقائياً بحساب المكتب وجلب صفحة واحدة بالحجم المطلوب
export async function POST(request: Request) {
  const g = await guard("subscribers.import");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }
  const { towerId, page, count, panelId } = parsed.data;

  // عزل المستأجر: لا يُجلب من SAS إلا لمكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  // 🔴 أ-٢٣ · كان الجلبُ من **أعمدة المكتب** حصراً، فمكتبٌ بلوحتَين لا يُستورَد من لوحته
  // الثانية **أبداً** — مع أنّ مسارَ الاستيراد نفسَه (`sas4/import`) يقبل `panelId` ويتحقّق
  // منه. فالشاشةُ تعرض مشتركي لوحةٍ واحدةٍ والاستيرادُ يقبل الأخرى ⇒ ١٣٣٢ مشتركاً في لوحة
  // «صميم2» لا سبيلَ إليهم. (بلاغُ محمد 2026-08-13.) والفارغُ يُبقي السلوكَ القديم حرفيّاً.
  // 🔒 واللوحةُ يجب أن تتبع هذا المكتب — وإلّا جُلب من لوحةِ مكتبٍ آخرَ بتمرير معرّف.
  if (panelId != null) {
    const owned = await prisma.sasPanel.findFirst({ where: { id: panelId, towerId, isDeleted: false }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "اللوحة لا تتبع هذا المكتب" }, { status: 403 });
  }
  const creds = panelId != null ? await credsOfPanel(panelId) : await credsOfTower(towerId);
  if (!creds?.loginUrl || !creds.username || !creds.password) {
    return NextResponse.json(
      { error: panelId != null ? "لوحةُ الساس تنقصها بيانات الدخول" : "المكتب لا يحتوي رابط SAS4 واسم مستخدم وكلمة سر" },
      { status: 400 },
    );
  }
  // حماية SSRF: امنع اتصال الخادم بعنوان لوحة داخلي/محلي (يمرّ IP العام للوحات SAS)
  if (await sasHostBlocked(creds.loginUrl)) {
    return NextResponse.json({ error: "عنوان لوحة المكتب غير مسموح" }, { status: 403 });
  }

  try {
    const base = sasBaseUrl(creds.loginUrl);
    const token = await sasLogin(base, creds.username, creds.password);
    const { users, total, lastPage } = await sasFetchOnePage(base, token, page, count);

    // 🔴 **علّتان في سطرٍ واحد** (بلاغُ محمد 2026-08-13):
    // (١) بلا `isDeleted: false` ⇒ المحذوفُ ناعماً يُعَدُّ «مستورداً» **فلا يُستورَد مرّةً
    //     أخرى أبداً**. وهو ما وقع: حُذف ٢١٧٢ مشتركاً حذفاً ناعماً فظهروا كلُّهم «مستوردين»
    //     والشاشةُ مقفلةٌ عليهم. **والمحذوفُ ليس مستورداً — هو محذوف.**
    // (٢) 🛡️ وبلا `towerId` ⇒ يُطابَق `sasId` في **كلّ مكاتب كلّ الوكلاء**: فمشتركٌ برقمٍ
    //     مشابهٍ عند وكيلٍ آخر يقفل استيرادَ مشتركك، وهي قراءةٌ عابرةٌ للعزل.
    // ومسارُ الاستيراد (`sas4/import:59`) يُرشِّح بالاثنَين أصلاً ⇒ فكانت الشاشةُ تقول
    // «مستورد» والاستيرادُ يقول «غيرُ مستورد» — رقمان لحقيقةٍ واحدة.
    const existing = await prisma.subscriber.findMany({
      where: { sasId: { in: users.map((u) => u.sasId) }, towerId, isDeleted: false },
      select: { sasId: true },
    });
    const existingIds = new Set(existing.map((e) => e.sasId));

    return NextResponse.json({
      total,
      lastPage,
      page,
      count,
      users: users.map((u) => ({ ...u, alreadyImported: existingIds.has(u.sasId) })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "فشل الاتصال بـ SAS4" },
      { status: 502 },
    );
  }
}
