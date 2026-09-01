import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";
import { getCompanySession, ensureCompanyUsersTable } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

// موظّفو الشركة — يُديرهم **المديرُ** حصراً (لا الموظف). كلُّ مديرٍ يرى موظفيه فقط (parentId).
// وظيفةُ الموظف: متابعةُ الطلبات وإسنادُها. لا يُنشئ موظفين ولا يعدّل إعلانات.
async function requireManager(): Promise<{ error: NextResponse; session?: undefined } | { error?: undefined; session: NonNullable<Awaited<ReturnType<typeof getCompanySession>>> }> {
  const s = await getCompanySession();
  if (!s) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  if (s.role !== "manager") return { error: NextResponse.json({ error: "للمدير فقط" }, { status: 403 }) };
  return { session: s };
}

export async function GET() {
  const g = await requireManager();
  if (g.error) return g.error;
  await ensureCompanyUsersTable();
  const rows = await prisma.companyUser.findMany({
    where: { role: "employee", parentId: g.session.companyUserId, isDeleted: false },
    select: { id: true, username: true, plainPassword: true, createdAt: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(rows.map((r) => ({ id: r.id, username: r.username, password: decryptSecret(r.plainPassword), createdAt: r.createdAt })));
}

const schema = z.object({
  username: z.string().min(3, "اسم المستخدم ٣ أحرف على الأقل").regex(/^[A-Za-z0-9._-]+$/, "أحرف إنجليزية وأرقام فقط"),
  password: z.string().min(8, "كلمة المرور ٨ أحرف على الأقل"),
});

export async function POST(request: Request) {
  const g = await requireManager();
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { username, password } = parsed.data;
  await ensureCompanyUsersTable();
  const taken = await prisma.companyUser.findUnique({ where: { username }, select: { id: true } });
  if (taken) return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
  try {
    await prisma.companyUser.create({
      data: {
        username, password: await hashPassword(password), plainPassword: encryptSecret(password),
        role: "employee", parentId: g.session.companyUserId,
      },
    });
  } catch (e) {
    // سباقُ إنشاءٍ متزامنٍ لنفس اليوزر ⇒ P2002 ⇒ ردٌّ نظيفٌ بدل 500 خام
    if ((e as { code?: string })?.code === "P2002") return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
