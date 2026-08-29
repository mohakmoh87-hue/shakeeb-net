import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession, clearCompanySession, ensureCompanyUsersTable, newSessionToken } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

// خروجُ الشركة — يمسحُ الكوكيَّ **ويُدوّر رمزَ الخادم** فيُبطل أيَّ نسخةٍ من التوكن نُسخت لجهازٍ آخر.
export async function POST() {
  const s = await getCompanySession();
  if (s) {
    try {
      await ensureCompanyUsersTable();
      await prisma.companyUser.update({ where: { id: s.companyUserId }, data: { sessionToken: newSessionToken() } });
    } catch { /* لا نُفشل الخروج إن تعذّر التدوير — الكوكي يُمسَح أدناه */ }
  }
  await clearCompanySession();
  return NextResponse.json({ ok: true });
}
