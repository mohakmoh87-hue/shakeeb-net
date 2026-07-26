import { NextResponse } from "next/server";
import { guardAny, agentTowerIds } from "@/lib/guard";
import { runManualSync, getManualSyncStatus, setManualSyncStatus } from "@/lib/subscriptionSync";

export const dynamic = "force-dynamic";

// المزامنة اليدوية الشاملة: تعمل بالخلفية وتكتب حالتها في قاعدة البيانات،
// والواجهة تستطلع GET حتى الانتهاء ثم تعرض النتائج كاملة — لا مهلات ولا «طلب مكرّر».
// (لوحة SAS على عنوان عام فيصلها الخادم مباشرة — لا حاجة للمرور بحاسبة المكتب.)

async function guardOffice(id: string): Promise<{ towerId: number } | { error: NextResponse }> {
  // المزامنة صلاحية مستقلة عن تعديل/حذف المكتب: يكفي offices.sync (أو offices.manage للمدير الكامل)
  const g = await guardAny("offices.sync", "offices.manage");
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

  const st = await getManualSyncStatus(towerId);
  const running = st?.state === "running"
    && Date.now() - new Date(st.startedAt).getTime() < 30 * 60 * 1000; // أقدم من 30 دقيقة = عالقة، يُسمح بالبدء
  if (running) return NextResponse.json({ started: true, joined: true });

  // كتابة الحالة قبل الإطلاق كي يجدها أول استطلاع فوراً
  await setManualSyncStatus(towerId, { state: "running", step: "sync", startedAt: new Date().toISOString() });
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
  const st = await getManualSyncStatus(g.towerId);
  if (!st || st.state !== "running") return NextResponse.json({ ok: true, wasRunning: false });
  await setManualSyncStatus(g.towerId, { ...st, cancel: true });
  return NextResponse.json({ ok: true, wasRunning: true });
}
