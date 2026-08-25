import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope, ownsTower, agentTowerIds } from "@/lib/guard";
import { ensureOfficeCatalog, clearCatalogCache } from "@/lib/itemCatalog";

const schema = z.object({
  name: z.string().min(1, "اسم المادة مطلوب"),
  category: z.string().nullable().optional(),
  priceSale: z.coerce.number().nullable().optional(),
  priceSale2: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  count: z.coerce.number().nullable().optional(),
  barcode: z.string().nullable().optional(),
  towerId: z.coerce.number().nullable().optional(), // للمدير: اختيار مكتب المخزن
});

export async function GET(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  // مخزن مستقل لكل مكتب؛ المدير يرى كل المكاتب — مع فلتر اختياري بمكتب معيّن (officeId)
  const sp = new URL(request.url).searchParams;
  const officeId = Number(sp.get("officeId")) || null;
  // فاتورة المبيع تطلب المتوفّر فقط: ما رصيده صفر يُعرض في المخزن ليُزاد، ولا يُعرض للبيع
  const inStockOnly = sp.get("inStock") === "1";
  const scope = await towerScope(g.session);
  // الفلتر لا يتجاوز العزل: يُطبَّق فقط إن كان المكتب يتبع الوكيل
  const officeFilter = officeId != null && (await ownsTower(g.session, officeId)) ? { towerId: officeId } : {};

  // كتالوج الوكيل: أسماء المدير تظهر في كل مكتب ولو بصفر — يُستكمل الناقص عند أول فتح
  // للشاشة (شفاء ذاتي، فلا يحتاج مكتبٌ جديد ولا مادةٌ جديدة تدخّلاً يدوياً)
  const ensureIds =
    officeId != null && (await ownsTower(g.session, officeId))
      ? [officeId]
      : g.session && !g.session.isAdmin && g.session.towerId != null
        ? [g.session.towerId]
        : await agentTowerIds(g.session);
  await ensureOfficeCatalog(g.session?.agentId ?? null, ensureIds).catch(() => {});

  const items = await prisma.item.findMany({
    where: {
      isDeleted: false, ...scope, ...officeFilter,
      ...(inStockOnly ? { count: { gt: 0 } } : {}),
    },
    orderBy: { id: "asc" },
  });
  // كلفة الشراء سرّ إداري: تُحجب عن غير المدير من الردّ نفسه (لا إخفاءً بالواجهة فقط).
  // سعر البيع يبقى — يحتاجه الموظّف في البيع.
  if (!g.session?.isAdmin) {
    return NextResponse.json(items.map((it) => ({ ...it, priceDinar: null })));
  }
  return NextResponse.json(items);
}

// إضافة مادة جديدة — للمدير فقط. المستخدم العادي لا يُنشئ مواد، يزيد كمياتها فقط (PUT).
export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  if (!g.session?.isAdmin) {
    return NextResponse.json({ error: "إضافة مادة جديدة من صلاحية المدير فقط" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  // مستخدم المكتب: يُفرض مكتبه دائماً؛ المدير: يختار المكتب من الجسم (أو بلا مكتب)
  const towerId =
    g.session && !g.session.isAdmin && g.session.towerId != null
      ? g.session.towerId
      : parsed.data.towerId ?? null;
  // عزل المستأجر: المكتب المحدّد يجب أن يتبع وكيل المستخدم
  if (towerId != null && !(await ownsTower(g.session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }
  // 📦 «يجب إدخالُ سعر المادة عند زيادة عددها» — والإنشاءُ بكميّةٍ **هو أوّلُ دفعة**،
  //    فيلزمه سعرُها كما تلزم الزيادةَ. وإنشاءٌ بصفرٍ (اسمٌ للكتالوج) لا يُطالَب بشيء.
  const openCount = parsed.data.count ?? 0;
  const openPrice = parsed.data.priceDinar ?? 0;
  if (openCount > 0 && !(openPrice > 0)) {
    return NextResponse.json({ error: "أدخل سعر المادة (الكلفة) — لا تُقبل كميّةٌ افتتاحيّةٌ بلا سعر" }, { status: 400 });
  }
  const created = await prisma.item.create({ data: { ...parsed.data, towerId } });
  // 📦 قيدُ الدفعة الافتتاحيّة — فلا يبدأ السجلُّ من الزيادة الثانية ويُخفي أوّلَ شراء
  if (openCount > 0) {
    const { batchTag } = await import("@/app/api/_lib/itemBatchLog");
    await prisma.auditLog.create({
      data: {
        userId: g.session?.userId ?? null,
        action: "ITEM_QTY_UP", entity: "item", entityId: String(created.id),
        details: `دفعة افتتاحية «${parsed.data.name}» من 0 إلى ${openCount} (+${openCount})`
          + ` — سعر شراء الدفعة ${Math.round(openPrice)} — مكتب ${towerId ?? "—"}`
          + (g.session?.fullName || g.session?.username ? ` — بواسطة ${g.session.fullName ?? g.session.username}` : "")
          + batchTag(0, openCount, openPrice),
      },
    }).catch(() => { /* لا يُفشل الإنشاءَ قيدٌ */ });
  }
  // المادة الجديدة تظهر فوراً في كل مكاتب الوكيل بكمية صفر — فمن اشتراها يزيد كميته بنفسه
  clearCatalogCache();
  await ensureOfficeCatalog(g.session?.agentId ?? null, await agentTowerIds(g.session), { force: true }).catch(() => {});
  return NextResponse.json(created, { status: 201 });
}
