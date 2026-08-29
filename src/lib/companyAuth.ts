import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";
import { getPortalEnabled } from "./appConfig";

// ═════ جلسةُ بوّابة سوبر سيل (الشركة) — طرفٌ خارجيٌّ معزولٌ تماماً (طلبُ محمد 2026-08-29) ═════
//
// **كودٌ جديدٌ منفصلٌ بالكامل، صفرُ مساسٍ بجلسة المستخدم الداخليّة (auth.ts)**:
//   · كوكي منفصل `kabina_company` ⇒ getSession (المستخدم) لا يراها أبداً، ولا العكس.
//   · صلاحيّةٌ محدودةٌ (لا users.manage ولا أيّ صلاحيّةِ نظام) ⇒ يتجاوزُ علّتَي م-٠ الداخليّتَين.
//   · إبطالٌ حيٌّ صحيحٌ كلَّ طلب: يُعيد قراءةَ الصفّ من القاعدة + رمزُ جهازٍ واحد + فحصُ تفعيل
//     البوّابة — فإطفاءُ البوّابة أو حذفُ الحساب أو دخولٌ من جهازٍ آخر يُنهي الجلسةَ فوراً.
//   · الجدولُ يُنشأ كسولاً (لا migrate على النشر) مرّةً واحدة.

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const COOKIE = "kabina_company";
const MAX_AGE = 60 * 60 * 24 * 365; // سنة (والإبطالُ الحيُّ يحمي مهما طال)

export interface CompanySessionPayload {
  kind: "company";
  companyUserId: number;
  username: string;
  sessionToken?: string;
}

// إنشاءُ جدول company_users كسولاً (CREATE TABLE IF NOT EXISTS) — لأنّ النشرَ لا يُشغّل migrate.
let tableReady = false;
export async function ensureCompanyUsersTable(): Promise<void> {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "company_users" (
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

export async function setCompanySession(payload: CompanySessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}

export async function clearCompanySession() {
  const store = await cookies();
  store.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
}

// يقرأ جلسةَ الشركة الحاليّة مع إبطالٍ حيّ. null إن: لا توكن/كوكي · ليست kind=company · الحساب
// محذوف · رمزُ الجهاز لا يطابق · **البوّابة مطفأة** (إطفاؤها يُخرِج الشركةَ فوراً).
export async function getCompanySession(): Promise<CompanySessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  let payload: CompanySessionPayload;
  try {
    const { payload: p } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if ((p as { kind?: string }).kind !== "company") return null;
    payload = p as unknown as CompanySessionPayload;
  } catch {
    return null;
  }
  try {
    if (!(await getPortalEnabled())) return null; // البوّابةُ مطفأة ⇒ لا جلسة (داخل try للتدهور اللطيف)
    await ensureCompanyUsersTable();
    const row = await prisma.companyUser.findUnique({
      where: { id: payload.companyUserId },
      select: { id: true, username: true, isDeleted: true, sessionToken: true },
    });
    if (!row || row.isDeleted) return null;
    if (row.sessionToken && payload.sessionToken !== row.sessionToken) return null;
    return { kind: "company", companyUserId: row.id, username: row.username, sessionToken: payload.sessionToken };
  } catch {
    return null;
  }
}
