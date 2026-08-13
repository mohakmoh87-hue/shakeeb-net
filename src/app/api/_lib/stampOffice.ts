import { distanceMeters } from "@/lib/attendance";

// ===== أ-١٠ · قرارُ «في أيّ مكتبٍ بصم؟» — دالّةٌ نقيّةٌ بلا قاعدة =====
// **القاعدةُ الحاكمة (قرارُ محمد 2026-08-11):** «يستطيع بصمَ دخولٍ من مكتبٍ والخروجَ من مكتبٍ
// آخر، وكلُّ الإجراءات ترجع إلى مكتبه الأصليّ.» ⇒ هذه الدالّةُ تُجيب عن **أين** بصم فقط،
// ولا شأنَ لها بـ**لمن** يُحتسَب (ذاك `towerId` = مكتبُه الأصليُّ دائماً).
//
// ⚠️ ولماذا نقيّةٌ ومستقلّة: كان الاختبارُ **ينسخ** هذا المنطقَ بدل استدعائه — فلو انحرف
// المسارُ عن الاختبار لم يفشل شيء، وصار الاختبارُ **يوثّق** ولا **يحرس**. (ملاحظةُ تدقيقٍ
// عدائيٍّ 2026-08-13.) وهي هنا لا في `src/lib/` عن قصد: `src/lib/` يُخرِج العاملَ من بوّابة
// `UI_ONLY` فتُهدَم جلساتُ الواتساب.

export type StampOffice = {
  id: number; name: string | null;
  geoEnabled: boolean; lat: number | null; lng: number | null; geoRadius: number | null;
};
export type StampResult = { office: number | null; error?: string };

export const GPS_MISSING = "تعذّر تحديد موقعك — فعّل الموقع (GPS) واسمح للتطبيق بالوصول إليه ثم أعد المحاولة";

/**
 * @param offices مكاتبُ الفنيّ المسموحة **وحدَها** (مُرشَّحةً في الخادم: غيرُ محذوفةٍ ومن مكاتب وكيله)
 * @param fallback المكتبُ المُعتمَدُ حين لا يحسم الموقعُ شيئاً (مكتبُه، أو مكتبُ دعمِ يومٍ كامل)
 */
export function decideStampOffice(
  offices: StampOffice[],
  fallback: number | null,
  lat: number | undefined,
  lng: number | undefined,
): StampResult {
  if (!offices.length) return { office: fallback };

  const fenced = offices.filter((o) => o.geoEnabled && o.lat != null && o.lng != null);
  // لا نطاقَ على أيٍّ من مكاتبه ⇒ لا تحقّقَ أصلاً، تماماً كحاله قبل البند
  if (!fenced.length) return { office: fallback };

  // 🔴 **ترتيبٌ حرِجٌ صحّحه التدقيقُ العدائيّ**: بوّابةُ «الافتراضيُّ بلا نطاق» تسبق طلبَ
  // الـGPS، لا تليه. فمَن مكتبُه **بلا نطاق** ثمّ أُسند له دعمٌ في مكتبٍ **مُفعَّل**، كان
  // يُطلَب منه الـGPS ويُمنَع بلا إحداثيّات — **وهو في مكتبه الذي لا قيدَ عليه أصلاً**.
  // فيُعاد الضررُ الذي وُلد البندُ لإصلاحه: بصمةٌ تُمنَع ظلماً = **يومُ راتبٍ يسقط**.
  const fallbackFenced = fallback != null && fenced.some((o) => o.id === fallback);

  const noCoords = typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng);
  if (noCoords) {
    if (!fallbackFenced && fallback != null) return { office: fallback };
    return { office: null, error: GPS_MISSING };
  }

  const measured = fenced
    .map((o) => ({ o, dist: distanceMeters(o.lat as number, o.lng as number, lat as number, lng as number), radius: o.geoRadius ?? 200 }))
    .sort((a, b) => a.dist - b.dist);
  const inside = measured.filter((m) => m.dist <= m.radius);
  if (inside.length) return { office: inside[0].o.id }; // الأقربُ الذي هو داخل نطاقه

  // لا مكتبَ مُفعَّلاً يطابق موقعَه. وإن كان الافتراضيُّ **بلا نطاق** فلا قيدَ عليه —
  // ومنعُه هنا تشديدٌ لم يكن موجوداً.
  if (!fallbackFenced && fallback != null) return { office: fallback };

  const n = measured[0];
  return { office: null, error: `يجب أن تكون داخل «${n.o.name ?? "المكتب"}» للبصمة — تبعد عنه ~${n.dist} م (المسموح ${n.radius} م)` };
}

/** المكتبُ المُعتمَدُ حين لا يحسم الموقع: دعمُ «يومٍ كامل» ينقله، ودعمُ «بطاقاتٍ» يُبقيه. */
export function fallbackOffice(
  t: { supportTowerId: number | null; supportKind: string | null },
  homeTower: number | null,
): number | null {
  return t.supportKind === "day" && t.supportTowerId != null ? t.supportTowerId : homeTower;
}
