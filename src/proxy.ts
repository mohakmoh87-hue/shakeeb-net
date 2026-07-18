import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// حماية المسارات (Proxy - بديل middleware في Next 16)
// فحص مبدئي خفيف للجلسة: يتحقق من صلاحية التوكن فقط (jose يعمل في بيئة edge)
if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET غير مضبوط في الإنتاج");
}
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-secret-change-me",
);
const PUBLIC_PATHS = ["/login", "/reset"];

// يعيد { authed, isTech } من توكن الجلسة (المستخدم أو الفني)
async function readSession(req: NextRequest): Promise<{ authed: boolean; isTech: boolean }> {
  const token = req.cookies.get("mynet_session")?.value;
  if (!token) return { authed: false, isTech: false };
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return { authed: true, isTech: (payload as { kind?: string }).kind === "technician" };
  } catch {
    return { authed: false, isTech: false };
  }
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const { authed, isTech } = await readSession(req);

  // غير مسجّل ويحاول دخول صفحة محمية → إلى تسجيل الدخول
  if (!authed && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  // الفني: مقصور على صفحة إدارة الفنيين فقط
  if (isTech) {
    if (!pathname.startsWith("/field-management")) {
      return NextResponse.redirect(new URL("/field-management", req.nextUrl));
    }
    return NextResponse.next();
  }
  // مستخدم مسجّل يحاول فتح صفحة الدخول → إلى لوحة التحكم
  if (authed && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // يعمل على كل المسارات ماعدا الملفات الثابتة و API
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
