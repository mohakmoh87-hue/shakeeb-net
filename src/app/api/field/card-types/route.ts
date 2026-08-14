import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { ensureFieldDefaultsOnce } from "@/app/api/_lib/fieldSeed";
import { weightOfKind } from "@/lib/achievements";

export const dynamic = "force-dynamic";

// أنواع البطاقات (متاحة للجميع للاختيار)
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  // أ-٣ · الزرعُ مرّةً واحدةً — لا إصلاحَ كسولاً يُعيد ما حذفه الوكيلُ عمداً
  await ensureFieldDefaultsOnce(s.agentId ?? null);
  const types = await prisma.cardType.findMany({
    where: { isDeleted: false, agentId: s.agentId ?? -1 }, orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  // نقاطُ الإنجاز: يُرسَل مع كلّ فئةٍ **وزنُها المبنيُّ** كي تُظهره الشاشةُ كقيمةٍ حاليّةٍ حين
  // لا يضبط المديرُ شيئاً. ويُحسَب هنا لا في المتصفّح — فـ`achievements.ts` يستورد `prisma`
  // فلو استُورد في مكوّنٍ عميلٍ لسُحبت القاعدةُ كلُّها إلى حزمة المتصفّح.
  return NextResponse.json({
    types: types.map((t) => ({ ...t, builtinWeight: weightOfKind(t.name) })),
  });
}

// دقائق ≥ 0 أو null
const toMin = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ===== نقاطُ الإنجاز لهذه الفئة (طلب محمد 2026-08-13) =====
// «يُعطي المديرُ نقاطاً لكلّ فئةٍ حسب ما يرغب، **ويمكن أن يكون صفراً**.»
// 🔑 والتمييزُ بين الفارغ والصفر هو **جوهرُ البند**:
//   ""/null ⇒ null = «اتركها كما هي في الكود» (٢ للتنصيب · ١ للصيانة · ٠٫٢٥ للتوصيل)
//   0       ⇒ 0    = «هذه الفئةُ لا تُحتسَب» — قرارٌ صريحٌ يجب أن يَصِل كما هو
// ⚠️ ولذلك لا تُكتب هذه الدالّةُ بنمط «Number(v) أو البديل»: الصفرُ زائفٌ في جافاسكربت
// فينقلب إلى null فيعود الوزنُ الافتراضيَّ ⇒ «صفّرتُها» تصير «أعطيتُها الافتراضيّ».
// والكسورُ مقبولةٌ (٠٫٢٥ مثلاً) فلا تقريبَ هنا خلافاً للدقائق.
const toWeight = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null; // قيمةٌ فاسدةٌ ⇒ تُعامَل كغير مضبوطة
  return n;
};

// إنشاء نوع بطاقة جديد — صلاحية إدارة الفنيين
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "اسم النوع مطلوب" }, { status: 400 });
  const agentId = g.session?.agentId ?? null; // عزل: أنواع وكيل المستخدم
  const exists = await prisma.cardType.findFirst({ where: { name, isDeleted: false, agentId: agentId ?? -1 } });
  if (exists) return NextResponse.json(exists, { status: 200 });
  const count = await prisma.cardType.count({ where: { isDeleted: false, agentId: agentId ?? -1 } });
  const created = await prisma.cardType.create({
    data: { name, deliveryOnly: !!b?.deliveryOnly, autoAssign: !!b?.autoAssign, position: count, agentId, execMinutes: toMin(b?.execMinutes), overrunDeduction: toMin(b?.overrunDeduction), achievementWeight: toWeight(b?.achievementWeight) },
  });
  return NextResponse.json(created, { status: 201 });
}

// تعديل نوع (الاسم/التوصيل/الوقت المسموح/خصم التجاوز/نقاط الإنجاز) — صلاحية إدارة الفنيين + عزل الوكيل
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const agentId = g.session?.agentId ?? -1;
  const type = await prisma.cardType.findFirst({ where: { id, agentId, isDeleted: false } });
  if (!type) return NextResponse.json({ error: "النوع غير موجود" }, { status: 404 });
  const data: { name?: string; deliveryOnly?: boolean; autoAssign?: boolean; execMinutes?: number | null; overrunDeduction?: number | null; achievementWeight?: number | null } = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.deliveryOnly === "boolean") data.deliveryOnly = b.deliveryOnly;
  if (typeof b.autoAssign === "boolean") data.autoAssign = b.autoAssign;
  if ("execMinutes" in b) data.execMinutes = toMin(b.execMinutes);
  if ("overrunDeduction" in b) data.overrunDeduction = toMin(b.overrunDeduction);
  // الفحصُ بوجودِ المفتاح لا بقيمته: فإرسالُ null صريحاً معناه «أعِدها إلى الوزن المبنيّ»
  if ("achievementWeight" in b) data.achievementWeight = toWeight(b.achievementWeight);
  const updated = await prisma.cardType.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// حذف نوع (منطقي) — صلاحية إدارة الفنيين
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await prisma.cardType.updateMany({ where: { id, agentId: g.session?.agentId ?? -1 }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
