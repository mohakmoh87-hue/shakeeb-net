import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { runMoneyHealth } from "@/lib/moneyHealth";

export const dynamic = "force-dynamic";

// ===== «سلامة المال» (طلب محمد 2026-08-12) =====
// «صفحةٌ فيها الحالاتُ الموجودة **ولا تكرارَ فيها أبداً**، وكلُّ حالةٍ بتفاصيلها وطريقةِ حلّها،
// ويمكن ضغطُ **تجاهل** فلا تُعاد. **ولا داعيَ لتنبيهٍ بالإيميل ولا أيّ شيءٍ آخر**.»
//
// 🔒 والعزل: `agentId` **من الجلسة لا من العميل** أبداً، وكلُّ فحصٍ مقصورٌ على مكاتب الوكيل.
//    ⇒ لا يرى وكيلٌ خللَ غيره — وهو شرطُ محمد الدائم («المكتبُ ليس تابعاً لي، وصفاءُ مسؤولٌ عن ماله»).

export async function GET() {
  // الصلاحيةُ نفسُها التي تحمي حسابات المدير — فهذه صفحةٌ منها
  const g = await guard("finance.view");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });

  const { checks, summary } = await runMoneyHealth(agentId);

  // التجاهلاتُ تُخفي **حالةً بعينها** لا صنفاً كاملاً
  const ignored = await prisma.moneyHealthIgnore.findMany({
    where: { agentId },
    select: { checkKey: true, rowKey: true, createdAt: true, byUser: true, note: true },
  });
  const ignoredSet = new Set(ignored.map((i) => `${i.checkKey}|${i.rowKey}`));

  const visible = checks.map((c) => {
    const cases = c.cases.filter((x) => !ignoredSet.has(`${x.checkKey}|${x.rowKey}`));
    return { ...c, cases, ok: cases.length === 0, hiddenCount: c.cases.length - cases.length };
  });

  const openCases = visible.reduce((a, c) => a + c.cases.length, 0);
  const critical = visible.reduce((a, c) => a + c.cases.filter((x) => x.severity === "critical").length, 0);

  return NextResponse.json({
    healthy: openCases === 0,
    openCases,
    critical,
    checks: visible,
    summary,
    ignoredCount: ignored.length,
  });
}

const ignoreSchema = z.object({
  checkKey: z.string().min(1).max(60),
  rowKey: z.string().min(1).max(120),
  note: z.string().max(300).optional(),
});

// تجاهُلُ حالة — أو إعادتُها (DELETE)
export async function POST(request: Request) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });
  const parsed = ignoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const { checkKey, rowKey, note } = parsed.data;

  // ⚠️ التجاهلُ **إخفاءٌ من القائمة فقط** — لا يُحذف مالٌ ولا يُصلَح شيءٌ صامتاً.
  await prisma.moneyHealthIgnore.upsert({
    where: { agentId_checkKey_rowKey: { agentId, checkKey, rowKey } },
    create: { agentId, checkKey, rowKey, note: note ?? null, byUser: g.session?.fullName ?? g.session?.username ?? null },
    update: { note: note ?? null },
  });
  // أثرٌ دائم: مَن تجاهل وماذا ومتى — فالمالُ لا يُخفى بلا اسم
  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId, action: "MONEY_HEALTH_IGNORE", entity: "moneyHealth", entityId: rowKey,
      details: `تجاهلُ حالة «${checkKey}» · ${rowKey}${note ? ` · ${note}` : ""}`,
    },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });
  const sp = new URL(request.url).searchParams;
  const checkKey = sp.get("checkKey") ?? "";
  const rowKey = sp.get("rowKey") ?? "";
  if (!checkKey || !rowKey) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  // 🔒 الحذفُ مقصورٌ على تجاهلات هذا الوكيل (`agentId` من الجلسة)
  await prisma.moneyHealthIgnore.deleteMany({ where: { agentId, checkKey, rowKey } });
  return NextResponse.json({ ok: true });
}
