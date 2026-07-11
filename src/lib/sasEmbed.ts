"use client";

// تجهيز تسجيل الدخول التلقائي للوحة SAS4 المضمّنة (عبر البروكسي):
// يجلب توكن SAS4 ويحقنه في localStorage (نفس origin البرنامج) قبل تحميل الإطار.
export async function prepareSasEmbed(towerId: number): Promise<boolean> {
  try {
    const res = await fetch("/api/sas4/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ towerId }),
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
export function sasProxyHash(towerId: number, hash: string): string {
  return `/sas/${towerId}/#/${hash.replace(/^#?\/?/, "")}`;
}
