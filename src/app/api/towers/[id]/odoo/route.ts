import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownsTower } from "@/lib/guard";
import { decryptSecret } from "@/lib/secretbox";
import { odooLogin } from "@/lib/odoo";

// إعداد ربط أودو لمكتب — **للمدير والمستخدم** (كلٌّ لمكتبه) عبر ownsTower.
// السرّ (odooPass) يُشفَّر؛ ولا يُكشف إطلاقاً في القراءة (فقط hasOdooCreds).

const schema = z.object({
  odooEnabled: z.string().nullable().optional(), // "0" | "1"
  odooUser: z.string().nullable().optional(),
  odooPass: z.string().nullable().optional(), // فارغ = أبقِ القديم
  odooUrl: z.string().nullable().optional(),
});

async function gate(params: Promise<{ id: string }>) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const { id } = await params;
  const towerId = Number(id);
  if (!(await ownsTower(session, towerId))) {
    return { error: NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 }) };
  }
  return { session, towerId };
}

// الحالة (للشارة الديناميّة في «إدارة الفنيين») — بلا كشف السرّ
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const t = await prisma.tower.findUnique({
    where: { id: g.towerId! },
    select: { odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true, odooLastOk: true, odooLastError: true },
  });
  if (!t) return NextResponse.json({ error: "المكتب غير موجود" }, { status: 404 });
  return NextResponse.json({
    odooEnabled: t.odooEnabled ?? "0",
    hasOdooCreds: !!(t.odooUser && t.odooPass),
    odooUser: t.odooUser ?? null, // اسم المستخدم فقط (مكتبه) — لا كلمة المرور أبداً
    odooUrl: t.odooUrl ?? null,
    odooLastOk: t.odooLastOk,
    odooLastError: t.odooLastError,
  });
}

// حفظ الإعداد. عند التفعيل بوجود بيانات ⇒ نجرّب دخولاً واحداً (سحابيّ، لمرّة) لضبط الشارة فوراً.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const towerId = g.towerId!;

  const parsed = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.odooEnabled != null) data.odooEnabled = parsed.data.odooEnabled;
  if (parsed.data.odooUser != null) data.odooUser = parsed.data.odooUser.trim();
  if (parsed.data.odooUrl != null) data.odooUrl = parsed.data.odooUrl.trim() || null;
  // كلمة المرور: الفراغ لا يمحو القديم؛ وإلا تُخزَّن نصّاً صريحاً (كـSAS) ليقرأها العامل بلا مفتاح
  if (parsed.data.odooPass != null && parsed.data.odooPass !== "") data.odooPass = parsed.data.odooPass;

  await prisma.tower.update({ where: { id: towerId }, data });

  // تفعيلٌ ببيانات كاملة ⇒ دخولٌ تجريبيّ لمرّة لضبط الشارة (أخضر/أحمر) و uid فوراً
  const after = await prisma.tower.findUnique({ where: { id: towerId }, select: { odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true } });
  if (after?.odooEnabled === "1" && after.odooUser && after.odooPass) {
    const pass = decryptSecret(after.odooPass) ?? "";
    try {
      const s = await odooLogin(after.odooUrl, after.odooUser, pass);
      await prisma.tower.update({ where: { id: towerId }, data: { odooLastOk: new Date(), odooUid: s.uid, odooLastError: null } });
    } catch (e) {
      await prisma.tower.update({ where: { id: towerId }, data: { odooLastOk: null, odooLastError: (e as Error).message?.slice(0, 200) ?? "فشل الدخول" } });
    }
  }

  const t = await prisma.tower.findUnique({
    where: { id: towerId },
    select: { odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true, odooLastOk: true, odooLastError: true },
  });
  return NextResponse.json({
    ok: true,
    odooEnabled: t?.odooEnabled ?? "0",
    hasOdooCreds: !!(t?.odooUser && t?.odooPass),
    odooLastOk: t?.odooLastOk ?? null,
    odooLastError: t?.odooLastError ?? null,
  });
}
