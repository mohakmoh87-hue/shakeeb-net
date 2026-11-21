import { getViewerSession, type ViewerSessionPayload } from "./auth";
import { towerIdsOfAgent } from "./guard";

// 👁️ نطاقُ مستخدم المشاهدة — مصدرٌ واحدٌ للحقيقة تستعمله مسارات `/api/watch/*` كلُّها.
// العزلُ **بالمعرّفات** لا بالنصّ: مكتبُه وحدَه، أو مكاتبُ وكيله إن كان نطاقُه كلَّ المكاتب.
// وبلا وكيلٍ أو بلا مكتبٍ (ونطاقُه مكتبُه) ⇒ null ⇒ المسارُ يرفض بـ٤٠٣: فشلٌ مُغلَق.
export type ViewerScope = { viewer: ViewerSessionPayload; towerIds: number[] };

export async function viewerScope(): Promise<ViewerScope | null> {
  const viewer = await getViewerSession();
  if (!viewer || viewer.agentId == null) return null;
  if (!viewer.viewAllOffices) {
    return viewer.towerId == null ? null : { viewer, towerIds: [viewer.towerId] };
  }
  const towerIds = await towerIdsOfAgent(viewer.agentId);
  return towerIds.length ? { viewer, towerIds } : null;
}
