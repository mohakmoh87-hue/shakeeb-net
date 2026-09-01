import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";

// ═════ جلسةُ أدمن تطبيق المشترك (كابينة) — طرفٌ إداريٌّ معزولٌ تماماً (طلبُ محمد 2026-09-01) ═════
//
// **كودٌ منفصلٌ بالكامل، صفرُ مساسٍ بجلسة المستخدم الداخليّة (auth.ts) ولا جلسةِ الشركة (companyAuth.ts)**:
//   · كوكي منفصل `kabina_appadmin` ⇒ لا getSession ولا getCompanySession تراها، ولا العكس.
//   · لا صلاحيّةَ نظامٍ داخليّة ⇒ يتجاوزُ علّتَي م-٠ الداخليّتَين (كحساب الشركة).
//   · إبطالٌ حيٌّ كلَّ طلب: يُعيد قراءةَ الصفّ + رمزُ جهازٍ واحد — فحذفُ الحساب أو دخولٌ من
//     جهازٍ آخر يُنهي الجلسةَ فوراً. (لا بوّابةَ تُطفئه: أدمنُ التطبيق مستقلٌّ عن سوبر سيل.)
//   · الجدولُ يُنشأ كسولاً (لا migrate على النشر) مرّةً واحدة.

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const COOKIE = "kabina_appadmin";
const MAX_AGE = 60 * 60 * 24 * 365; // سنة (والإبطالُ الحيُّ يحمي مهما طال)

export interface AppAdminSessionPayload {
  kind: "appadmin";
  appAdminId: number;
  username: string;
  sessionToken?: string;
}

// إنشاءُ جدول app_admins كسولاً (CREATE TABLE IF NOT EXISTS) — لأنّ النشرَ لا يُشغّل migrate.
let tableReady = false;
export async function ensureAppAdminsTable(): Promise<void> {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "app_admins" (
      "id" SERIAL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "plainPassword" TEXT,
      "sessionToken" TEXT,
      "isDeleted" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  tableReady = true;
}

export function newSessionToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function setAppAdminSession(payload: AppAdminSessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}

export async function clearAppAdminSession() {
  const store = await cookies();
  store.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
}

// يقرأ جلسةَ أدمن التطبيق مع إبطالٍ حيّ. null إن: لا توكن/كوكي · ليست kind=appadmin · الحساب
// محذوف · رمزُ الجهاز لا يطابق.
export async function getAppAdminSession(): Promise<AppAdminSessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  let payload: AppAdminSessionPayload;
  try {
    const { payload: p } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if ((p as { kind?: string }).kind !== "appadmin") return null;
    payload = p as unknown as AppAdminSessionPayload;
  } catch {
    return null;
  }
  try {
    await ensureAppAdminsTable();
    const row = await prisma.appAdmin.findUnique({
      where: { id: payload.appAdminId },
      select: { id: true, username: true, isDeleted: true, sessionToken: true },
    });
    if (!row || row.isDeleted) return null;
    if (row.sessionToken && payload.sessionToken !== row.sessionToken) return null;
    return { kind: "appadmin", appAdminId: row.id, username: row.username, sessionToken: payload.sessionToken };
  } catch {
    return null;
  }
}
