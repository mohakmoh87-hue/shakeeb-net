"use client";

// كشف العامل المحلي على حاسبة المكتب (المنفذ 47615). إن كان موجوداً، تُوجَّه عمليات
// SAS إليه مباشرةً (سريع، قرب خادم SAS)؛ وإلا تُستعمل مسارات Vercel (ارتداد آمن).
// http://127.0.0.1 يُعامَل كسياق آمن في المتصفّح فلا يُحجب رغم أن الصفحة https.
let cachedBase = "";
let lastProbe = 0;

export async function localSasBase(): Promise<string> {
  // نُخزّن النجاح؛ وعند الفشل نُعيد المحاولة كل 15 ثانية (تحسّباً لبدء العامل لاحقاً)
  if (cachedBase) return cachedBase;
  if (Date.now() - lastProbe < 15000) return "";
  lastProbe = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("http://127.0.0.1:47615/health", { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) cachedBase = "http://127.0.0.1:47615";
  } catch { /* لا عامل محلي — نعتمد على Vercel */ }
  return cachedBase;
}
