import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOfficeFilter } from "@/lib/guard";
import { readOfficeStates } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// حالة واتساب للتنبيه: كل مستخدم يُنبَّه على مكتبه فقط، والأدمن على كل المكاتب
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  // عزل المستأجر: مستخدم المكتب ⇒ مكتبه؛ مدير الوكيل ⇒ كل مكاتب وكيله
  const officeFilter = await agentOfficeFilter(session);

  // المكاتب التي تحتاج واتساب (لمشتركيها أو لمديرها) — مستقل عن مفتاح رسائل المشتركين
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, OR: [{ NOT: { waEnabled: "0" } }, { managerPhone: { not: null } }], ...officeFilter },
    select: { id: true, name: true, waEnabled: true, managerPhone: true },
  });
  const states = await readOfficeStates(offices.map((o) => o.id));
  // ═════ التنبيهُ يقول **لماذا** يحتاجه هذا المكتب (سؤالُ محمد 2026-08-13) ═════
  // قال: «تظهر لي غيرُ متصلٍ في الرئيسيّة وأجدُ المكاتبَ الثلاثةَ متّصلة». والقياسُ
  // كشف أنّ المقصودَ **مكتبُ الشهداء**: واتسابُه مُطفأٌ **للمشتركين** (`waEnabled=0`)
  // لكنّ له **رقمَ مدير** ⇒ يُحصى بحقٍّ لأنّ **تقريرَ المدير يُرسَل عبر واتساب**.
  // فالتنبيهُ كان صادقاً، والناقصُ **سببُه**: «غير متصل» بلا سببٍ تُقرأ عطلاً، فيفتح
  // المديرُ بطاقاتِ المكاتب المُشتغَلة فيجدها متّصلةً فيظنّ البرنامجَ كاذباً.
  // ⇒ يُرسَل `need` مع كلّ مكتب، وتُظهره الشاشةُ بجانب اسمه.
  const list = offices.map((o) => ({
    id: o.id, name: o.name,
    state: states[o.id] ?? "disconnected",
    // "subscribers" = رسائلُ المشتركين (وتقريرُ المدير معها إن وُجد رقمُه)
    // "manager"     = تقريرُ المدير **فقط** — مكتبٌ أُطفئت رسائلُ مشتركيه بقصد
    need: o.waEnabled !== "0" ? ("subscribers" as const) : ("manager" as const),
  }));
  return NextResponse.json({ offices: list, disconnected: list.filter((o) => o.state !== "ready") });
}
