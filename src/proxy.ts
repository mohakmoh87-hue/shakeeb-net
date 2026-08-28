import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// حماية المسارات (Proxy - بديل middleware في Next 16)
// فحص مبدئي خفيف للجلسة: يتحقق من صلاحية التوكن فقط (jose يعمل في بيئة edge)
// يُستثنى طور البناء (Cloud Build بلا متغيرات بيئة) — الفشل الصريح يبقى وقت التشغيل
if (
  !process.env.AUTH_SECRET &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("AUTH_SECRET غير مضبوط في الإنتاج");
}
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-secret-change-me",
);
// 🏢 /supercell (2026-08-28): صفحةُ عرضِ بوّابة سوبر سيل — ملفٌّ ثابتٌ ببياناتٍ وهميّة
//    تفتحه الشركةُ بلا حساب؛ معزولٌ تماماً (لا قاعدةَ ولا جلسات) فإتاحتُه لا تفتح شيئاً.
// 📱 /app (2026-08-28): معاينةُ ستايل تطبيق المشترك «كابينة» — نفسُ الوصفة والعزل حرفيّاً.
const PUBLIC_PATHS = ["/login", "/reset", "/about", "/supercell", "/app"];

// يعيد { authed, isTech } من توكن الجلسة (المستخدم أو الفني)
async function readSession(req: NextRequest): Promise<{ authed: boolean; isTech: boolean }> {
  const token = req.cookies.get("mynet_session")?.value;
  if (!token) return { authed: false, isTech: false };
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    return { authed: true, isTech: (payload as { kind?: string }).kind === "technician" };
  } catch {
    return { authed: false, isTech: false };
  }
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const { authed, isTech } = await readSession(req);

  // الصفحات العامة (دخول/استرجاع/تعريف) متاحة دائماً — حتى لو حمل الطلب توكناً صالحاً شكلياً.
  // حسّاس: بدون هذا الاستثناء المبكر، جلسةٌ مُبطَلة في القاعدة (جلسة واحدة/تعطيل/حذف حساب)
  // لكن توكنها لم ينتهِ زمنياً بعد، تسبّب حلقة توجيه لا نهائية (ERR_TOO_MANY_REDIRECTS):
  // الوسيط يوثّق بالتوكن (edge بلا قاعدة) فيعيد الفني إلى /field-management،
  // بينما حارس الصفحة (getTechSession) يوثّق بالقاعدة فيعيده إلى /login — فيتقاذفانه للأبد.
  // إتاحة /login دائماً تكسر الحلقة: الجهاز المُخرَج يصل لصفحة الدخول ويُعيد المصادقة.
  if (isPublic) return NextResponse.next();

  // غير مسجّل ويحاول دخول صفحة محمية → إلى تسجيل الدخول
  if (!authed) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  // الفني: مقصور على صفحة إدارة الفنيين فقط
  if (isTech && !pathname.startsWith("/field-management")) {
    return NextResponse.redirect(new URL("/field-management", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // يعمل على كل المسارات ماعدا الملفات الثابتة و API و عامل الخدمة/بيان التطبيق (يجب أن تُفتح بلا تسجيل دخول)
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|manifest.json|icons/|shakeeb-net.apk).*)"],
};
