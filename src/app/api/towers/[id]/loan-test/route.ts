import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { decryptSecret } from "@/lib/secretbox";
import { testLoanConnection } from "@/lib/supercellLoan";

// اختبار اتصال قروض سوبر سيل لمكتب — للمدير حصراً، بلا أيّ منح.
// يقبل بيانات النموذج الحاليّة (قد لا تكون محفوظة بعد)؛ وإن غابت كلمة المرور يستعمل المخزّنة.
const schema = z.object({
  loanUser: z.string().nullable().optional(),
  loanPass: z.string().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("offices.edit");
  if (g.error) return g.error;
  if (!g.session?.isAdmin) return NextResponse.json({ error: "إعداد القرض للمدير حصراً" }, { status: 403 });

  const { id } = await params;
  const towerId = Number(id);
  if (!(await ownsTower(g.session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const tower = await prisma.tower.findUnique({ where: { id: towerId }, select: { loanUser: true, loanPass: true } });
  const loanUser = (parsed.data.loanUser ?? tower?.loanUser ?? "").trim();
  // كلمة المرور: المُدخلة إن وُجدت، وإلا المخزّنة (مفكوكة)
  const loanPass = parsed.data.loanPass && parsed.data.loanPass !== ""
    ? parsed.data.loanPass
    : (decryptSecret(tower?.loanPass) ?? "");
  if (!loanUser || !loanPass) {
    return NextResponse.json({ ok: false, message: "أدخل اسم المستخدم وكلمة المرور أولاً" });
  }

  // عيّنة مشترك من نفس المكتب (له sasId) لاختبار المسار كاملاً
  const sample = await prisma.subscriber.findFirst({
    where: { towerId, isDeleted: false, sasId: { not: null } },
    select: { sasId: true },
    orderBy: { id: "desc" },
  });

  const res = await testLoanConnection({ loanUser, loanPass, sampleSasId: sample?.sasId ?? null });
  return NextResponse.json(res);
}
