"use client";

// كشف العامل المحلي على حاسبة المكتب (المنفذ 47615). إن كان موجوداً، تُوجَّه عمليات
// SAS إليه مباشرةً (سريع، قرب خادم SAS)؛ وإلا تُستعمل مسارات Vercel (ارتداد آمن).
// http://127.0.0.1 يُعامَل كسياق آمن في المتصفّح فلا يُحجب رغم أن الصفحة https.
let cachedBase: string | null = null;

export async function localSasBase(): Promise<string> {
  if (cachedBase !== null) return cachedBase;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("http://127.0.0.1:47615/health", { signal: ctrl.signal });
    clearTimeout(t);
    cachedBase = r.ok ? "http://127.0.0.1:47615" : "";
  } catch {
    cachedBase = ""; // لا عامل محلي — نعتمد على Vercel
  }
  return cachedBase;
}
