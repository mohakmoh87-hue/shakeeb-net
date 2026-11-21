import { NextResponse } from "next/server";
import { viewerScope } from "@/lib/viewerScope";
import { towerIdsOfAgent } from "@/lib/guard";
import { manualAssigneeOptions } from "@/lib/autoAssign";

export const dynamic = "force-dynamic";

// 👁️ فنيّو مكتبٍ لاختيار المشاهد — **الاسمُ والمعرّفُ فقط**.
// ولا يُعاد استعمالُ `/api/field/technicians`: ذاك يكشف الراتبَ ورمزَ الدخول وإعداداتِ
// الدوام لمن يملك `field.manage`، والمشاهدُ لا صلاحيّةَ له أصلاً — فمسارٌ ضيّقٌ أسلم.
// والمكتبُ يجب أن يكون داخلَ نطاقه هو، والأهليّةُ بنفس قاعدة قبول الخادم عند الحفظ.
export async function GET(request: Request) {
  const sc = await viewerScope();
  if (!sc) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!Number.isInteger(officeId) || officeId <= 0) return NextResponse.json({ error: "مكتب غير صحيح" }, { status: 400 });
  if (!sc.towerIds.includes(officeId)) return NextResponse.json({ error: "المكتب خارج نطاقك" }, { status: 403 });

  // الأهليّةُ تُحسب على مكاتب **الوكيل** كلِّها (الدعمُ والمكاتبُ الإضافيّة ومجموعةُ اللوحة)،
  // تماماً كما حين يرفع مستخدمُ المكتب البطاقةَ نفسَها — والمكتبُ نفسُه محصورٌ بنطاق المشاهد أعلاه.
  const agentTowers = sc.viewer.agentId != null ? await towerIdsOfAgent(sc.viewer.agentId) : [];
  const techs = await manualAssigneeOptions(officeId, agentTowers);
  return NextResponse.json({ techs });
}
