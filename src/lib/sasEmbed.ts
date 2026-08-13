"use client";

// تجهيز تسجيل الدخول التلقائي للوحة SAS4 المضمّنة (عبر البروكسي):
// يجلب توكن SAS4 ويحقنه في localStorage (نفس origin البرنامج) قبل تحميل الإطار.
export async function prepareSasEmbed(towerId: number, panelId?: number | null): Promise<boolean> {
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
    if (!res.ok) return false;
    const { token, apiUrl } = await res.json();
    localStorage.setItem("sas4_jwt", token);
    localStorage.setItem("sas4_api_url", apiUrl);
    return true;
  } catch {
    return false;
  }
}

// رابط الصفحة المضمّنة عبر البروكسي (نفس origin)
export function sasProxyHash(towerId: number, hash: string, panelId?: number | null): string {
  const q = panelId != null ? `?panel=${panelId}` : "";
  return `/sas/${towerId}/${q}#/${hash.replace(/^#?\/?/, "")}`;
}
