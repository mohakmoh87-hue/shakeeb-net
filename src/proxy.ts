import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// حماية المسارات (Proxy - بديل middleware في Next 16)
// فحص مبدئي خفيف للجلسة: يتحقق من صلاحية التوكن فقط (jose يعمل في بيئة edge)
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-secret-change-me",
);
const PUBLIC_PATHS = ["/login", "/reset"];

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("mynet_session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const authed = await hasValidSession(req);

  // غير مسجّل ويحاول دخول صفحة محمية → إلى تسجيل الدخول
  if (!authed && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  // مسجّل ويحاول فتح صفحة الدخول → إلى لوحة التحكم
  if (authed && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // يعمل على كل المسارات ماعدا الملفات الثابتة و API
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
