// ═════ 🔴 لوحتان مفتوحتان معاً ⇒ «Access Denied» (بلاغُ صميم 2026-08-13، الارتداد الثاني) ═════
//
// الحادثة: مكتبٌ بلوحتَي ساس (صميم ١ و صميم ٢، وكلتاهما على المُخدِّم `82.129.22.22`).
// يُفتح تفعيلٌ من الثانية فيرفض الساسُ العمليّة. وأُصلح مرّةً بحقنِ رمزِ اللوحة الصحيحة
// عند تحميل الصفحة — **فارتدّ**، لأنّ العلّةَ ليست في أوّل تحميلٍ بل في **ما بعده**.
//
// والسببُ أنّ اللوحةَ المقصودةَ كانت تُحفَظ في **خزائنَ مشتركةٍ ذاتِ خانةٍ واحدة**، وكلُّها
// «آخرُ مَن فُتح يفوز» — فتبويبان مفتوحان يتقاتلان على خانةٍ واحدة:
//   ١. `localStorage.sas4_jwt` — لكلّ **المتصفّح** (والأصلُ واحدٌ لكلّ اللوحات).
//   ٢. كعكةُ `sas_panel` — لكلّ **المتصفّح** أيضاً (مسارُ السحابة).
//   ٣. `currentPanel` — متغيّرٌ عامٌّ في عاملِ المكتب (المسارُ المحلّيّ).
// ⇒ فمَن فتح «صميم ١» ثمّ «صميم ٢» صارت أفعالُه **من التبويبَين كليهما** تذهب إلى الثانية.
//
// 🔑 والحلُّ إسقاطُ الخزائن المشتركة من الطريق: **اللوحةُ تسافر في المسار نفسِه**
//   (`/sas/43~p11/…`). والمسارُ ملكُ التبويب لا ملكُ المتصفّح، ويورَّث تلقائياً لكلّ
//   طلبٍ نسبيٍّ عبر `<base href>` — فلا خانةَ يُتقاتَل عليها أصلاً.
//
// وتبقى الصيغةُ القديمة (`?panel=` والكعكة) مقبولةً: تبويبٌ مفتوحٌ الآن لا يُكسَر.

/** نطاقُ لوحةٍ داخل مكتب: مقطعُ المسار `43` أو `43~p11`. */
export type SasScope = { towerId: number; panelId: number | null };

/** بناءُ مقطع المسار الحامل للّوحة. بلا لوحةٍ ⇒ المقطعُ القديمُ حرفيّاً (لا تغييرَ سلوك). */
export function sasScopeSegment(towerId: number, panelId?: number | null): string {
  return panelId != null && Number.isInteger(panelId) && panelId > 0 ? `${towerId}~p${panelId}` : String(towerId);
}

/** قراءةُ المقطع. يُرجع `null` إن لم يكن مُعرِّفَ مكتبٍ صالحاً — فلا يُخمَّن رقمٌ من نصٍّ فاسد. */
export function parseSasScope(segment: string): SasScope | null {
  const m = /^(\d+)(?:~p(\d+))?$/.exec(segment.trim());
  if (!m) return null;
  const towerId = Number(m[1]);
  if (!Number.isInteger(towerId) || towerId <= 0) return null;
  const panelId = m[2] ? Number(m[2]) : null;
  if (panelId != null && (!Number.isInteger(panelId) || panelId <= 0)) return null;
  return { towerId, panelId };
}

/** رابطُ اللوحة المضمّنة — المقطعُ يحمل اللوحةَ فتبقى مع كلّ طلبٍ داخليّ. */
export function sasScopedPath(towerId: number, panelId?: number | null, hash?: string): string {
  const seg = sasScopeSegment(towerId, panelId);
  const h = hash ? `#/${hash.replace(/^#?\/?/, "")}` : "";
  return `/sas/${seg}/${h}`;
}
