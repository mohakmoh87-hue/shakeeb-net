"use client";

import { useCallback, useEffect, useState } from "react";
import { prepareSasEmbed } from "@/lib/sasEmbed";
import { computeDateTo } from "@/lib/subscription";

// صيغة قيمة حقل التاريخ yyyy-MM-dd (توقيت محلي)
function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Pkg = { id: number; name: string | null; priceDinar: number | null };
type Tower = { id: number; loginUrl: string | null; activationTemplate: string | null; activationMode?: string | null };
export type ActSubscriber = {
  id: number;
  name: string | null;
  packageId: number | null;
  towerId: number | null;
  netUser: string | null;
  sasId: number | null;
  carry: number | null;
  dateTo: string | null;
};

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

// رابط صفحة تفعيل المشترك عبر البروكسي (نفس origin + دخول تلقائي)
function sasUrl(sub: ActSubscriber): string | null {
  if (!sub.towerId || !sub.sasId) return null;
  return `/sas/${sub.towerId}#/user/activate/${sub.sasId}`;
}
// رابط SAS4 الخارجي المباشر (لفتحه بنافذة جديدة عند الحاجة)
function sasDirectUrl(tower: Tower | undefined, sub: ActSubscriber): string | null {
  if (!tower?.loginUrl || !sub.sasId) return null;
  const host = tower.loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return `https://${host}/#/user/activate/${sub.sasId}`;
}

export default function ActivationModal({
  subscriber,
  packages,
  tower,
  onClose,
  onDone,
}: {
  subscriber: ActSubscriber;
  packages: Pkg[];
  tower: Tower | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [packageId, setPackageId] = useState<number | "">(subscriber.packageId ?? "");
  const [card, setCard] = useState<{ id: number; serial: string | null } | null>(null);
  const [available, setAvailable] = useState<number>(0);
  const [paid, setPaid] = useState("");
  const [months, setMonths] = useState(1); // عدد الأشهر (افتراضي 1)
  const [amount, setAmount] = useState(""); // مبلغ التفعيل يدوياً (فارغ = سعر الباقة × الأشهر)
  const [delivery, setDelivery] = useState(""); // مبلغ التوصيل (يُضاف على مبلغ الاشتراك)
  // تاريخ الانتهاء الافتراضي = التاريخ الطبيعي حسب نظام المكتب وعدد الأشهر (قابل للتعديل)
  const [expiry, setExpiry] = useState(() => {
    const now = new Date();
    const start = subscriber.dateTo && new Date(subscriber.dateTo) > now ? new Date(subscriber.dateTo) : now;
    return toInputDate(computeDateTo(start, 1, tower?.activationMode));
  });
  const [copied, setCopied] = useState(false);
  const [loadingCard, setLoadingCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pkg = packages.find((p) => p.id === packageId);
  const packagePrice = pkg?.priceDinar ?? 0;
  const packageTotal = packagePrice * (months || 1); // إجمالي سعر الباقة لعدد الأشهر
  const price = amount !== "" ? Number(amount) || 0 : packageTotal; // مبلغ التفعيل الفعلي (الاشتراك)
  const deliveryAmount = Number(delivery) || 0; // مبلغ التوصيل
  const grandTotal = price + deliveryAmount; // الإجمالي المستحق (اشتراك + توصيل)

  // إعادة حساب تاريخ الانتهاء الطبيعي عند تغيير عدد الأشهر
  useEffect(() => {
    const now = new Date();
    const start = subscriber.dateTo && new Date(subscriber.dateTo) > now ? new Date(subscriber.dateTo) : now;
    setExpiry(toInputDate(computeDateTo(start, months || 1, tower?.activationMode)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months]);
  const directLink = sasDirectUrl(tower, subscriber);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);

  // تسجيل الدخول التلقائي للوحة SAS4 المضمّنة ثم تحميلها
  useEffect(() => {
    let active = true;
    const proxied = sasUrl(subscriber);
    if (!subscriber.towerId || !proxied) { setFrameSrc(null); return; }
    prepareSasEmbed(subscriber.towerId).then((ok) => {
      if (active) setFrameSrc(ok ? proxied : directLink);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber.id]);

  const copy = useCallback((serial: string | null) => {
    if (!serial) return;
    navigator.clipboard?.writeText(serial).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  }, []);

  // عند تغيير الفئة: أرجِع أي كارت محجوز سابقاً وامسح الكارت (لا سحب تلقائي)
  useEffect(() => {
    setCard(null);
    if (packageId) {
      fetch(`/api/recharge-cards/next?packageId=${packageId}`)
        .then((r) => (r.ok ? r.json() : { available: 0 }))
        .then((d) => setAvailable(d.available ?? 0));
    } else setAvailable(0);
  }, [packageId]);

  // سحب كارت يدوياً (حجز ذرّي) + نسخه للحافظة
  async function pullCard() {
    if (!packageId) { setError("اختر الفئة أولاً"); return; }
    setError(""); setLoadingCard(true);
    try {
      const res = await fetch("/api/recharge-cards/pull", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "تعذّر سحب كارت"); return; }
      setCard(d.card); setAvailable(d.available);
      if (d.card?.serial) copy(d.card.serial);
    } catch { setError("تعذّر الاتصال بالخادم"); }
    finally { setLoadingCard(false); }
  }

  // إرجاع الكارت للمخزون عند الإغلاق دون تأكيد
  function releaseAndClose() {
    if (card?.id) {
      fetch("/api/recharge-cards/release", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: card.id }),
      }).catch(() => {});
    }
    onClose();
  }

  async function confirm() {
    setError("");
    if (!packageId) { setError("اختر الفئة"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/subscribers/${subscriber.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId,
          cardId: card?.id ?? null,
          paid: Number(paid) || 0,
          months: months || 1,
          totalOverride: amount !== "" ? Number(amount) || 0 : null,
          delivery: deliveryAmount,
          dateToOverride: expiry || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل التفعيل"); return; }
      onDone();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setSaving(false); }
  }

  const remaining = grandTotal - (Number(paid) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={releaseAndClose}>
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* الترويسة */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <h3 className="text-lg font-bold text-slate-800">تفعيل — {subscriber.name}</h3>
          <button onClick={releaseAndClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* صفحة SAS4 مضمّنة (أعلى على الهاتف / يسار على الكمبيوتر) */}
          <div className="flex h-[45vh] shrink-0 flex-col border-b border-slate-200 md:h-auto md:flex-1 md:border-b-0 md:border-l">
            <div className="flex items-center justify-between bg-slate-100 px-3 py-1.5 text-xs">
              <span className="font-semibold text-slate-600">صفحة تفعيل المشترك في SAS4 (دخول تلقائي)</span>
              {directLink && <a href={directLink} target="_blank" rel="noopener noreferrer" className="text-mynet-blue hover:underline">فتح بنافذة جديدة ↗</a>}
            </div>
            {frameSrc ? (
              <iframe
                src={frameSrc}
                className="flex-1 border-0"
                title="SAS4 activation"
                // عزل يمنع الساس من إعادة تحميل/تنقّل النافذة العليا (فتُغلق نافذة التفعيل)،
                // مع إبقاء نفس الأصل ليعمل الدخول التلقائي والنماذج
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                {subscriber.sasId ? "جاري تسجيل الدخول التلقائي..." : "هذا المشترك غير مربوط بـ SAS4"}
              </div>
            )}
          </div>

          {/* أدوات التفعيل (أسفل على الهاتف / يمين على الكمبيوتر) */}
          <div className="w-full shrink-0 space-y-4 p-4 md:w-[340px] md:overflow-y-auto">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">الفئة (السرعة)</label>
              <select value={packageId} onChange={(e) => setPackageId(Number(e.target.value) || "")} className="w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">— اختر الفئة —</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({fmt(p.priceDinar)} د.ع)</option>)}
              </select>
            </div>

            {/* الكارت */}
            {packageId !== "" && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                {card?.serial ? (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-emerald-600">الكارت منسوخ ✓ — الصقه بصفحة SAS4</span>
                      <span className="text-xs text-slate-400">متاح: {available}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-white px-3 py-2 text-lg font-bold tracking-wider text-slate-800" dir="ltr">{card.serial}</code>
                      <button onClick={() => copy(card.serial)} className="rounded-lg bg-slate-200 px-3 py-2 text-sm hover:bg-slate-300" title="نسخ">📋{copied ? "✓" : ""}</button>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="mb-2 text-xs text-slate-500">متاح لهذه الفئة: {available} كارت</div>
                    <button onClick={pullCard} disabled={loadingCard || available === 0} className="w-full rounded-lg bg-amber-500 py-2.5 font-bold text-white shadow hover:bg-amber-600 disabled:opacity-50">
                      {loadingCard ? "جاري السحب..." : available === 0 ? "لا توجد كروت متاحة" : "🎴 سحب كارت"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* المبلغ + زر الإدخال السريع */}
            <div className="rounded-lg border border-slate-200 p-3">
              {/* عدد الأشهر */}
              <label className="mb-1 block text-sm font-medium text-slate-700">عدد الأشهر</label>
              <div className="mb-3 flex items-center gap-2">
                <button onClick={() => setMonths((m) => Math.max(1, m - 1))} className="h-9 w-9 shrink-0 rounded-lg bg-slate-200 text-lg font-bold hover:bg-slate-300">−</button>
                <input
                  type="number"
                  min={1}
                  value={months}
                  onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center"
                />
                <button onClick={() => setMonths((m) => m + 1)} className="h-9 w-9 shrink-0 rounded-lg bg-slate-200 text-lg font-bold hover:bg-slate-300">+</button>
              </div>

              {/* مبلغ التفعيل (قابل للتعديل يدوياً للحالات النادرة) */}
              <label className="mb-1 block text-sm font-medium text-slate-700">مبلغ التفعيل</label>
              <div className="mb-1 flex gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(packageTotal)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
                {amount !== "" && (
                  <button onClick={() => setAmount("")} title="رجوع لسعر الباقة" className="shrink-0 rounded-lg bg-slate-200 px-3 py-2 text-sm hover:bg-slate-300">↺</button>
                )}
              </div>
              <div className="mb-3 text-xs text-slate-400">
                سعر الباقة: {fmt(packagePrice)} د.ع{months > 1 ? ` × ${months} = ${fmt(packageTotal)} د.ع` : ""} — اتركه فارغاً لاستخدامه، أو أدخل مبلغاً خاصاً
              </div>

              {/* مبلغ التوصيل (يُضاف على مبلغ الاشتراك ويظهر في رسالة التفعيل) */}
              <label className="mb-1 block text-sm font-medium text-slate-700">مبلغ التوصيل (اختياري)</label>
              <input
                type="number"
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
                placeholder="0"
                className="mb-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <div className="mb-3 text-xs text-slate-400">
                {deliveryAmount > 0
                  ? `الإجمالي المستحق = اشتراك ${fmt(price)} + توصيل ${fmt(deliveryAmount)} = ${fmt(grandTotal)} د.ع`
                  : "يُضاف على مبلغ الاشتراك ويُذكر للمشترك في رسالة التفعيل"}
              </div>

              {/* تاريخ الانتهاء (اختياري - للحالات الخاصة مثل شهرين أو 20 يوماً) */}
              <label className="mb-1 block text-sm font-medium text-slate-700">تاريخ الانتهاء</label>
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="mb-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                dir="ltr"
              />
              <div className="mb-3 text-xs text-slate-400">
                {card
                  ? "🎴 عند سحب كارت يُعتمد تاريخ الانتهاء الفعلي من SAS تلقائياً (يراعي قرض اليوم) بدل هذا الحقل"
                  : "معبّأ افتراضياً بالتاريخ الطبيعي حسب نظام المكتب — عدّله للحالات الخاصة"}
              </div>

              <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ الواصل</label>
              <div className="flex gap-2">
                <input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                <button
                  onClick={() => setPaid(String(grandTotal))}
                  disabled={!grandTotal}
                  title="إدخال الإجمالي (اشتراك + توصيل)"
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  ➕ {fmt(grandTotal)}
                </button>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-500">الباقي (دين)</span>
                <span className={`font-bold ${remaining > 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(remaining)} د.ع</span>
              </div>
            </div>

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

            <button onClick={confirm} disabled={saving} className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-60">
              {saving ? "جاري..." : "✅ تأكيد التفعيل"}
            </button>
            <button onClick={releaseAndClose} className="w-full rounded-lg bg-slate-100 py-2 text-slate-600 hover:bg-slate-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
