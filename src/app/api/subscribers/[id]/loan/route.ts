import { NextResponse } from "next/server";
import { requireTower } from "@/lib/requireTower";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { decryptSecret } from "@/lib/secretbox";
import { grantLoan } from "@/lib/supercellLoan";
import { sendLoanMessage } from "@/lib/loanMessage";

// منح «قرض فزعة» لمشترك — عمليّة صامتة عبر خادمنا. عزلٌ صارم:
//   • الوكيل: sameAgentTower (لا يُمنح إلا مشترك يتبع وكيل المستخدم).
//   • المكتب: يُستعمل حساب قروض **مكتب المشترك نفسه** حصراً (لكلّ مكتب دخوله).
//   • الفنيّ مُستبعَد (guard يرفض جلسة الفنيّ). مدير + مستخدم فقط.
const LOAN_DAYS = 30; // الأيام الوهميّة محليّاً (الساس يمنح 7 حقيقيّة، والمزامنة تتجاهل صاحب القرض)

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const subscriberId = Number(id);

  // عزل الوكيل: لا يُمنح إلا مشترك يتبع وكيل المستخدم (نفس حارس التفعيل)
  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber || subscriber.isDeleted || !(await sameAgentTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  { const e = requireTower(subscriber.towerId, "منح القرض"); if (e) return e; }

  // عزل المكتب: القرض يمرّ عبر حساب قروض **مكتب المشترك نفسه** — لا مكتبٍ آخر
  const office = await prisma.tower.findUnique({
    where: { id: subscriber.towerId! },
    select: { id: true, name: true, agentId: true, waEnabled: true, loanEnabled: true, loanUser: true, loanPass: true },
  });
  if (!office || office.loanEnabled !== "1") {
    return NextResponse.json({ error: "قروض سوبر سيل غير مفعّلة لهذا المكتب" }, { status: 403 });
  }
  const loanUser = (office.loanUser ?? "").trim();
  const loanPass = decryptSecret(office.loanPass) ?? "";
  if (!loanUser || !loanPass) {
    return NextResponse.json({ error: "بيانات دخول القروض غير مكتملة لهذا المكتب" }, { status: 400 });
  }

  // حارس المطابقة يحتاج رقم الساس واليوزر المخزَّنَين
  if (!subscriber.sasId) {
    return NextResponse.json({ error: "المشترك غير مربوط بـ SAS — لا يمكن منح القرض" }, { status: 400 });
  }
  if (!subscriber.netUser || !subscriber.netUser.trim()) {
    return NextResponse.json({ error: "المشترك بلا اسم مستخدم — تعذّر التحقّق من الهويّة" }, { status: 400 });
  }

  // حارس لا-قرض-ثانٍ (عندنا): دَينُ قرضٍ قائم لهذا المشترك يمنع منح آخر
  const existing = await prisma.loanDebt.findFirst({ where: { subscriberId, isDeleted: false }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "لدى المشترك قرضٌ قائم غير مسدَّد" }, { status: 409 });
  }

  // مبلغ دين القرض = سعر باقته (معزول بوكيل المكتب — لا تُستعمل أسعار وكيلٍ آخر)
  let amount = 0;
  let packageId: number | null = null;
  if (subscriber.packageId) {
    const pkg = await prisma.package.findFirst({
      where: { id: subscriber.packageId, agentId: office.agentId ?? -1 },
      select: { id: true, priceDinar: true },
    });
    if (pkg) { amount = pkg.priceDinar ?? 0; packageId = pkg.id; }
  }

  // ===== المنح عبر سوبر سيل — ضمانات الأمان الثلاثة داخل grantLoan =====
  const res = await grantLoan({
    loanUser,
    loanPass,
    sasId: subscriber.sasId,
    expectedNetUser: subscriber.netUser.trim(),
  });
  if (!res.ok) {
    const status =
      res.reason === "mismatch" || res.reason === "has_loan" ? 409 :
      res.reason === "not_expired" ? 400 :
      502;
    return NextResponse.json({ error: res.message ?? "تعذّر منح القرض", reason: res.reason, got: res.got }, { status });
  }

  // ===== نجح المنح: الكتابات المحليّة (٣٠ يوماً وهميّة + دين قرض + سجلّ تدقيق) =====
  // المنح في سوبر سيل نهائيٌّ لا يُلغى؛ فإن فشلت القاعدة بعده نوثّق «قرضاً يتيماً» كي لا يضيع.
  const now = new Date();
  const expiryVirtual = new Date(now.getTime() + LOAN_DAYS * 86400000);
  try {
    await prisma.$transaction([
      prisma.subscriber.update({ where: { id: subscriberId }, data: { dateTo: expiryVirtual } }),
      prisma.loanDebt.create({
        data: {
          subscriberId,
          towerId: subscriber.towerId,
          agentId: office.agentId,
          amount,
          packageId,
          netUser: subscriber.netUser,
          sasId: subscriber.sasId,
          grantDate: now,
          expiryVirtual,
          prevDateTo: subscriber.dateTo, // تاريخ الانتهاء قبل القرض — لإرجاعه عند الإلغاء العكسيّ
          createdByUser: session?.username ?? null,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: session?.userId,
          action: "GRANT_LOAN",
          entity: "subscriber",
          entityId: String(subscriberId),
          details: `قرض فزعة — ${subscriber.netUser} — مبلغ ${amount} — مكتب ${office.name ?? subscriber.towerId} — ينتهي ${expiryVirtual.toISOString().slice(0, 10)}`,
        },
      }),
    ]);
  } catch (e) {
    // القرض مُنِح فعليّاً في سوبر سيل لكن تعذّر تسجيله محليّاً — نوثّقه بسجلٍّ مستقلّ للمراجعة اليدويّة
    try {
      await prisma.auditLog.create({
        data: {
          userId: session?.userId,
          action: "GRANT_LOAN_ORPHAN",
          entity: "subscriber",
          entityId: String(subscriberId),
          details: `⚠️ قرض مُنِح في سوبر سيل ولم يُسجَّل محليّاً — ${subscriber.netUser} — مبلغ ${amount} — ${(e as Error).message}`,
        },
      });
    } catch { /* القاعدة متعطّلة كليّاً — لا مزيد */ }
    return NextResponse.json(
      { error: "مُنِح القرض في سوبر سيل لكن تعذّر تسجيله محليّاً — راجع المشترك يدويّاً", reason: "record_failed" },
      { status: 500 },
    );
  }

  // رسالة القرض (صامتة، لا تُعطّل المنح) — عزل: مكتب المشترك وحده
  void sendLoanMessage({
    subscriberId,
    officeId: subscriber.towerId,
    agentId: office.agentId,
    phone: subscriber.phone,
    waEnabled: subscriber.waEnabled,
    officeName: office.name,
    officeWaEnabled: office.waEnabled,
    name: subscriber.name,
    netUser: subscriber.netUser,
    amount,
    expiryVirtual,
    createdByUser: session?.username ?? null,
  });

  return NextResponse.json({ ok: true, verifiedUser: res.verifiedUser, amount, expiryVirtual });
}
