import { NextResponse } from "next/server";
import { meter } from "@/app/api/_lib/egressMeter";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sasScopeSegment } from "@/lib/sasScope";
import { guard, ownsTower } from "@/lib/guard";
import { sasBaseUrl, sasLogin } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { credsOfPanel, credsOfTower } from "@/lib/sasPanel";

// أ-٢٣ · اللوحةُ المطلوبُ فتحُها. فارغةٌ = أعمدةُ المكتب (السلوكُ القديم حرفيّاً)
const schema = z.object({ towerId: z.coerce.number(), panelId: z.coerce.number().optional() });

// جلب توكن SAS4 للمكتب (لتسجيل الدخول التلقائي في الصفحة المضمّنة)
export async function POST(request: Request) {
  const g = await guard("subscribers.import");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  // عزل المستأجر: لا يُصدَّر توكن SAS إلا لمكتب يتبع وكيل المستخدم (يمنع فتح لوحة وكيل آخر)
  if (!(await ownsTower(g.session, parsed.data.towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  // ═════ 🔴 بلاغُ محمد 2026-08-13 ═════
  // «الاستيرادُ من الساس الأوّل يعمل، لكن عند الاستيراد من الساس الثاني يرجعه ويُظهر له
  //  مشتركي الساس الأوّل.»
  // **والعلّةُ هنا**: هذا المسارُ كان يقرأ `towerId` **وحدَه**، فيسجّل الدخولَ دائماً بحساب
  // **أعمدة المكتب** — وهي حسابُ اللوحة الأولى. فمهما اختار المديرُ «صميم2» من القائمة،
  // الرمزُ (JWT) الذي يستعمله الإطارُ هو رمزُ «صميم1» ⇒ **مشتركو اللوحة الأولى دائماً**.
  // ⚠️ ولوحتا صميم على **نفس المُخدِّم** (`82.129.22.22`) بحسابَين مختلفَين — فالعنوانُ لم
  // يكن ليكشف العلّةَ أبداً، **الحسابُ هو الفارق**.
  const { towerId, panelId } = parsed.data;
  // 🔒 واللوحةُ يجب أن تتبع هذا المكتب — وإلّا فُتح حسابُ لوحةِ مكتبٍ آخرَ بتمرير معرّف
  if (panelId != null) {
    const owned = await prisma.sasPanel.findFirst({ where: { id: panelId, towerId, isDeleted: false }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "اللوحة لا تتبع هذا المكتب" }, { status: 403 });
  }
  const creds = panelId != null ? await credsOfPanel(panelId) : await credsOfTower(towerId);
  if (!creds?.loginUrl || !creds.username || !creds.password) {
    return NextResponse.json({ error: panelId != null ? "بيانات اللوحة ناقصة" : "بيانات المكتب ناقصة" }, { status: 400 });
  }
  // حماية SSRF: امنع اتصال الخادم بعنوان لوحة داخلي/محلي (يمرّ IP العام للوحات SAS)
  if (await sasHostBlocked(creds.loginUrl)) {
    return NextResponse.json({ error: "عنوان لوحة المكتب غير مسموح" }, { status: 403 });
  }

  try {
    const base = sasBaseUrl(creds.loginUrl);
    const token = await sasLogin(base, creds.username, creds.password);
    // مسار الـ API عبر البروكسي (نفس origin البرنامج)
    // 🔑 ومسارُ الـAPI يحمل **اللوحةَ** في مقطعه: فطلباتُ اللوحة الداخليّةُ تصل موسومةً
    //   بلوحتها، فلا تحتاج كعكةً ولا متغيّراً عامّاً — ولا يطمسها تبويبٌ آخرُ مفتوح.
    const apiUrl = `/sas/${sasScopeSegment(towerId, panelId)}/admin/api/index.php/api/`;
    const host = creds.loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    const res = NextResponse.json({ token, apiUrl });
    // 📏 عدّادُ «كم مرّةً اختير المسارُ السحابيّ أصلاً؟» — هذا النداءُ لا يقع إلّا حين لا
    //   يُعثَر على العامل المحلّيّ، فعددُه **مقياسُ فشلِ الجسّ** مباشرةً. وبعد إصلاح
    //   الخانق يجب أن يهبط إلى ما يقارب الصفر على حاسبات المكاتب (ويبقى للهواتف).
    //   والبايتاتُ هنا تافهةٌ — المقصودُ العدُّ لا الحجم.
    meter("/api/sas4/token", 0);
    // كوكي المضيف والمكتب لبروكسي /admin/* والتقاط العرض
    res.cookies.set("sas_host", host, { path: "/", httpOnly: true, sameSite: "lax" });
    res.cookies.set("sas_tower", String(towerId), { path: "/", httpOnly: true, sameSite: "lax" });
    // 🔑 وكوكيُّ اللوحة: صفحةُ الساس تطبيقٌ أحاديُّ الصفحة، وطلباتُها الداخليّةُ تذهب إلى
    // `/sas/<id>/...` **بلا `?panel=`** ⇒ فكان الوسيطُ يعود إلى أعمدة المكتب في كلّ طلبٍ
    // تالٍ. فتُلتصَق اللوحةُ بكوكي، ويقرؤها الوسيطُ متى غاب المعامل.
    res.cookies.set("sas_panel", panelId != null ? String(panelId) : "", { path: "/", httpOnly: true, sameSite: "lax" });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "فشل تسجيل الدخول إلى SAS4" },
      { status: 502 },
    );
  }
}
