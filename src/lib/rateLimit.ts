// محدِّد معدّل بسيط في الذاكرة (نافذة منزلقة) — دفاع أساسي ضد الإساءة على المسارات العامة.
// ملاحظة: على الاستضافة الخادمية يعمل لكل نسخة على حدة؛ يقلّل الاندفاعات لا أكثر.
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) buckets.clear(); // حدّ للذاكرة
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// عنوان IP للعميل من ترويسات الوكيل العكسي
export function clientIp(request: Request): string {
  const h = request.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim() || "unknown";
}
