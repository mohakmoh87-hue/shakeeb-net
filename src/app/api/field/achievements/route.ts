import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeAchievements } from "@/lib/achievements";

export const dynamic = "force-dynamic";

// ===== إنجازات الفنيين ومسابقة فترة الراتب (طلب محمد 2026-08-05) =====
// شاشة المدير: ترتيب **كل فنيّي مكاتبه معاً** (لا مكتباً مكتباً) بالنقاط الموزونة
// بصعوبة الفئة وسرعة الإنجاز داخلها. الفترة الافتراضية = فترة الراتب الحالية.
//
// ?from=YYYY-MM-DD&to=YYYY-MM-DD لفترة أخرى · ?leader=1 يكتفي بالمتصدّر (لبطاقة الرئيسية).
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const leaderOnly = sp.get("leader") === "1";

  // ===== الترتيب يراه كل مكاتب الوكيل (تصحيح محمد 2026-08-05) =====
  // كان الجدول الكامل مقصوراً على صلاحية إدارة الفنيين — والمسابقة بطبيعتها تُرى:
  // ترتيب فنيّي **كل المكاتب** معاً، لا ترتيب كل مكتب في جزيرته. ولا مال فيه ولا سرّ،
  // إنما عدد بطاقات وزمن إنجاز. وزرّ الشاشة في لوحة الفنيين يبقى للمدير كما طلب.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const agentId = session.agentId ?? null; // العزل بالوكيل لا بالمكتب
  const from = (sp.get("from") ?? "").trim() || null;
  const to = (sp.get("to") ?? "").trim() || null;

  const data = await computeAchievements(agentId, from, to);
  if (leaderOnly) {
    return NextResponse.json({
      from: data.from, to: data.to,
      leader: data.leader
        ? { name: data.leader.name, office: data.leader.office, cards: data.leader.cards, points: data.leader.points, avgMin: data.leader.avgMin }
        : null,
      minCards: data.minCards,
    });
  }
  return NextResponse.json(data);
}
