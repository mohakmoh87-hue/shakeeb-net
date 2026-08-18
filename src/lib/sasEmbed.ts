"use client";

import { sasScopedPath } from "@/lib/sasScope";

// تجهيز تسجيل الدخول التلقائي للوحة SAS4 المضمّنة (عبر البروكسي):
// يجلب توكن SAS4 ويحقنه في localStorage (نفس origin البرنامج) قبل تحميل الإطار.
// ⚠️ النتيجةُ تحمل السبب (بلاغُ عليّ البياتي 2026-08-19): الفشلُ كان يُختزل إلى
//   `false` فيسقط الإطارُ إلى الساس الخام **بصمتٍ تامّ** — لا مَن يعرف أنّ التهيئةَ
//   فشلت ولا لماذا. والسببُ المقروءُ هو ما يجعل بلاغَ العطل القادمَ تشخيصاً جاهزاً.
export type SasEmbedResult = { ok: true } | { ok: false; reason: string };

export async function prepareSasEmbed(towerId: number, panelId?: number | null): Promise<SasEmbedResult> {
  try {
    // أ-٢٣ · اللوحةُ تُمرَّر صريحةً: المسارُ يُرجع رمزَ **حسابِ اللوحة** ويضع كعكةَ
    // `sas_panel` — وصفحةُ الساس تطبيقٌ أحاديُّ الصفحة فطلباتُها الداخليّةُ بلا `?panel=`،
    // والكعكةُ هي ما يُبقي الوسيطَ على اللوحة الصحيحة. وبلاها يُفتَح حسابُ اللوحة
    // الأولى دائماً، فيردّ الساسُ «Access Denied» على مشتركِ اللوحة الثانية.
    const res = await fetch("/api/sas4/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ towerId, ...(panelId != null ? { panelId } : {}) }),
    });
    if (!res.ok) {
      // سببُ الخادم كما قاله (٤٠١/٤٠٣/٤٠٤/٥٠٠…) — هو لبُّ التشخيص
      const d = await res.json().catch(() => null);
      return { ok: false, reason: d?.error ? String(d.error) : `الخادم ردّ ${res.status}` };
    }
    const { token, apiUrl } = await res.json();
    localStorage.setItem("sas4_jwt", token);
    localStorage.setItem("sas4_api_url", apiUrl);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "تعذّر الاتصال بالخادم" };
  }
}

// رابط الصفحة المضمّنة عبر البروكسي (نفس origin)
export function sasProxyHash(towerId: number, hash: string, panelId?: number | null): string {
  return sasScopedPath(towerId, panelId, hash); // اللوحةُ في المسار — لا خانةَ مشتركةً تُتقاتَل
}
