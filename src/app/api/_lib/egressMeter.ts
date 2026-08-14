import { prisma } from "@/lib/prisma";

// ═══════════ عدّادُ النقل الصادر لكلّ مسار — إثباتُ مصدر الفاتورة لا تخمينُه ═══════════
//
// السياق (قياسُ 2026-08-15 من فاتورة Railway): النقلُ الصادر **٣٣٪** من الكلفة —
// ٥٫٣١ غيغا في يومَين، مقابل ٥٫٤٧ غيغا في **الشهر** كلِّه على أزور قبل التحويل. والفاتورة
// تُعطي **المجموع** ولا تقول أيُّ مسارٍ أنتجه، وسجلّاتُ Railway تُظهر مخرجاتِ التطبيق
// والقاعدة لا أحجامَ الاستجابات. فبلا هذا العدّاد يبقى السببُ استنتاجاً — وقد رفض محمد
// (بحقّ) أن نُصلح على ظنّ.
//
// 🎯 والمشتبهُ الأوّلُ مُسمّىً: وسيطُ لوحة الساس (`/sas/…`) — كلُّ ملفِّ جافاسكربت وصورةٍ
//    وخطٍّ في اللوحة يسافر من العراق إلى أمريكا ثمّ يعود إلى المتصفّح، **والعودةُ محسوبة**.
//    فإن أثبت العدّادُ أنّ الساسَ أغلبُ الرقم، فالعلاجُ توجيهُه للحاسبة المحلّيّة (وقد
//    أُصلح خانقُ الجسّ في الدفعة نفسِها) — وإن أثبت غيرَ ذلك، انتقلنا للمذنب الحقيقيّ.
//
// 💵 وتصميمُه محكومٌ بأنّ **القياسَ نفسَه لا يجوز أن يُضيف للفاتورة**:
//   · العدُّ في الذاكرة — لا كتابةَ قاعدةٍ لكلّ طلب (وهو ما كان سيصنع مشكلةً أكبر).
//   · الحفظُ صفٌّ واحدٌ في `system_settings` كلَّ ٥ دقائق **وفقط إن تغيّر شيء**.
//   · والحفظُ يتراكم على المخزون السابق، فإعادةُ تشغيل الموقع (كلُّ نشرة) لا تمسح القياس.
//   · وبلا تفاصيلَ شخصيّة: المفتاحُ **نوعُ المسار** لا الرابطُ الكامل (لا مُعرّفاتِ مشتركين).

type Bucket = { bytes: number; count: number };

const mem = new Map<string, Bucket>();
let dirty = false;
let lastFlush = 0;
const FLUSH_MS = 5 * 60_000;
const ROW_TYPE = "egressMeter";

/** تصنيفُ المسار إلى دلوٍ مقروء — بلا مُعرّفاتٍ كي لا ينفجر عددُ المفاتيح ولا تُخزَّن هويّات. */
export function bucketOf(pathname: string): string {
  if (pathname.startsWith("/sas/")) {
    // نفصل مستندَ اللوحة عن أصولها: «اللوحةُ تُفتح مرّةً» مقابل «كلُّ أصلٍ يُعاد تنزيله»
    return /\.(js|mjs|css|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|ico|map)$/i.test(pathname)
      ? "sas:asset" : "sas:page";
  }
  if (pathname.startsWith("/_next/static/")) return "next:static";
  if (pathname.startsWith("/api/")) {
    // أوّلُ مقطعَين بعد /api كافيان للتمييز (/api/subscribers/stats) وبلا مُعرّفات
    const seg = pathname.split("/").filter(Boolean).slice(1, 3).filter((s) => !/^\d+$/.test(s));
    return `api:${seg.join("/") || "?"}`;
  }
  return "page";
}

/** تسجيلُ استجابةٍ خرجت. يُنادى بعد معرفة الحجم — ولا يرمي أبداً (القياسُ لا يُعطّل خدمة). */
export function meter(pathname: string, bytes: number): void {
  try {
    if (!Number.isFinite(bytes) || bytes < 0) return;
    const k = bucketOf(pathname);
    const b = mem.get(k) ?? { bytes: 0, count: 0 };
    b.bytes += bytes; b.count += 1;
    mem.set(k, b);
    dirty = true;
    if (Date.now() - lastFlush > FLUSH_MS) void flush();
  } catch { /* القياسُ لا يُفشل طلباً أبداً */ }
}

/** يدمج ما في الذاكرة مع المخزون المحفوظ ويكتبه — ويُصفّر الذاكرة بعد نجاح الكتابة. */
export async function flush(): Promise<void> {
  if (!dirty || !mem.size) return;
  lastFlush = Date.now();
  const snapshot = new Map(mem);
  try {
    const row = await prisma.systemSetting.findFirst({ where: { type: ROW_TYPE }, select: { id: true, text: true } });
    let prev: { since?: string; buckets?: Record<string, Bucket> } = {};
    try { prev = row?.text ? JSON.parse(row.text) : {}; } catch { /* نصٌّ فاسد ⇒ نبدأ نظيفاً */ }
    const buckets: Record<string, Bucket> = { ...(prev.buckets ?? {}) };
    for (const [k, v] of snapshot) {
      const p = buckets[k] ?? { bytes: 0, count: 0 };
      buckets[k] = { bytes: p.bytes + v.bytes, count: p.count + v.count };
    }
    const text = JSON.stringify({
      since: prev.since ?? new Date().toISOString(),
      at: new Date().toISOString(),
      buckets,
    });
    if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
    else await prisma.systemSetting.create({ data: { type: ROW_TYPE, text } });
    // ✅ لا يُصفَّر إلّا بعد نجاح الكتابة — وإلّا ضاع القياسُ بين محاولتَين
    for (const [k, v] of snapshot) {
      const cur = mem.get(k);
      if (!cur) continue;
      cur.bytes -= v.bytes; cur.count -= v.count;
      if (cur.bytes <= 0 && cur.count <= 0) mem.delete(k);
    }
    dirty = mem.size > 0;
  } catch { /* الكتابةُ ستُعاد بعد ٥ دقائق — والقياسُ محفوظٌ في الذاكرة حتى تنجح */ }
}

/** القراءةُ للوحة المالك: المحفوظُ + ما لم يُحفَظ بعد. */
export async function readMeter(): Promise<{ since: string | null; at: string | null; buckets: Record<string, Bucket> }> {
  const row = await prisma.systemSetting.findFirst({ where: { type: ROW_TYPE }, select: { text: true } });
  let prev: { since?: string; at?: string; buckets?: Record<string, Bucket> } = {};
  try { prev = row?.text ? JSON.parse(row.text) : {}; } catch { /* */ }
  const buckets: Record<string, Bucket> = { ...(prev.buckets ?? {}) };
  for (const [k, v] of mem) {
    const p = buckets[k] ?? { bytes: 0, count: 0 };
    buckets[k] = { bytes: p.bytes + v.bytes, count: p.count + v.count };
  }
  return { since: prev.since ?? null, at: prev.at ?? null, buckets };
}
