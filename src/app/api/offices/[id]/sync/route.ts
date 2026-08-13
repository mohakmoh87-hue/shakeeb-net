import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { runManualSync, getManualSyncStatus, setManualSyncStatus, claimManualSync } from "@/lib/subscriptionSync";

export const dynamic = "force-dynamic";

// المزامنة اليدوية الشاملة: تعمل بالخلفية وتكتب حالتها في قاعدة البيانات،
// والواجهة تستطلع GET حتى الانتهاء ثم تعرض النتائج كاملة — لا مهلات ولا «طلب مكرّر».
// (لوحة SAS على عنوان عام فيصلها الخادم مباشرة — لا حاجة للمرور بحاسبة المكتب.)

async function guardOffice(id: string): Promise<{ towerId: number } | { error: NextResponse }> {
  // المزامنة صلاحية مستقلة تماماً عن تعديل/حذف المكتب (المدير يمرّ عبر isAdmin)
  const g = await guard("offices.sync");
  if (g.error) return { error: g.error };
  const towerId = Number(id);
  // عزل: المكتب يجب أن يتبع وكيل المستخدم
  const mine = await agentTowerIds(g.session ?? null);
  if (!mine.includes(towerId)) return { error: NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 }) };
  return { towerId };
}

// بدء المزامنة (أو الانضمام لواحدة جارية — لا تشغيل مزدوج)
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await guardOffice(id);
  if ("error" in g) return g.error;
  const { towerId } = g;

  // ب-١/الأصل ٥ · حَجزٌ ذرّيٌّ قبل الإطلاق (2026-08-13). كان هنا **فحصٌ ثمّ كتابة**:
  // يقرأ الحالةَ فإن لم تكن «جارية» يكتبها ويُطلق — وبينهما نافذةٌ تُمرّر ضغطتَين
  // متقاربتَين ⇒ مزامنتان على المكتب نفسِه: جلبُ ١٢٠ يوماً مرّتَين، **وتقريرُ واتسابٍ
  // كاملٌ يصل المديرَ مرّتَين**. والحجزُ يكتب الحالةَ نفسَها فيجدها أوّلُ استطلاعٍ فوراً.
  const { claimed } = await claimManualSync(towerId);
  if (!claimed) return NextResponse.json({ started: true, joined: true });
  void runManualSync(towerId); // بالخلفية — الخادم يواصل بعد الردّ
  return NextResponse.json({ started: true });
}

// حالة المزامنة الجارية/الأخيرة (تستطلعها الواجهة كل بضع ثوانٍ)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await guardOffice(id);
  if ("error" in g) return g.error;
  const st = await getManualSyncStatus(g.towerId);
  return NextResponse.json(st ?? { state: "idle" });
}

// إلغاء مزامنة جارية — ترفع راية تفحصها الحلقة فتتوقّف بنظافة عند أقرب نقطة
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await guardOffice(id);
  if ("error" in g) return g.error;
  // ملاحظة: `getManualSyncStatus` يحصد المنقطعةَ ويُرجعها `error` — فالحالةُ «الجارية»
  // هنا حيّةٌ بنبضها، والإلغاءُ التعاونيُّ صالحٌ لها. أمّا الميّتةُ فقد أُنهيت سلفاً
  // بالقراءة، فيُجاب «لم تكن جارية» وقد انفكّ القفلُ فعلاً — لا رايةٌ تُرفَع لمن لا يقرؤها.
  const st = await getManualSyncStatus(g.towerId);
  if (!st || st.state !== "running") return NextResponse.json({ ok: true, wasRunning: false });
  await setManualSyncStatus(g.towerId, { ...st, cancel: true });
  return NextResponse.json({ ok: true, wasRunning: true });
}
