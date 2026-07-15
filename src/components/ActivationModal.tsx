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
  transferredTo?: string | null; // اليوزر الجديد إن كان المشترك محوّلاً (للتنبيه)
};

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
const PAYMENT_METHODS = ["المكتب", "نقد", "تحويل", "أخرى"];

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
  const [master, setMaster] = useState(false); // تفعيل ماستر: واصل كامل بلا دين، بحساب مستقل
  const [months, setMonths] = useState(1); // عدد الأشهر (افتراضي 1)
  const [amount, setAmount] = useState(""); // كلفة الاشتراك يدوياً (فارغ = سعر الباقة × الأشهر)
  const [delivery, setDelivery] = useState(""); // اجور صيانة/توصيل (تُضاف على مبلغ الاشتراك)
  const [note, setNote] = useState(""); // ملاحظة الوصل
  const [dueDate, setDueDate] = useState(""); // موعد التسديد
  const [paymentMethod, setPaymentMethod] = useState("المكتب"); // طريقة الدفع
  const [manualDate, setManualDate] = useState(false); // تعديل تاريخ الانتهاء يدوياً
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
  const [transferSeen, setTransferSeen] = useState(false); // إشعار التحويل يظهر عند كل فتح للتفعيل

  const pkg = packages.find((p) => p.id === packageId);
  const packagePrice = pkg?.priceDinar ?? 0;
  const packageTotal = packagePrice * (months || 1); // إجمالي سعر الباقة لعدد الأشهر
  const price = amount !== "" ? Number(amount) || 0 : packageTotal; // كلفة الاشتراك الفعلية
  const deliveryAmount = Number(delivery) || 0; // اجور صيانة
  const grandTotal = price + deliveryAmount; // المجموع المستحق
  // ماستر: واصل كامل بلا دين جديد (يبقى دين المشترك السابق كما هو)
  const remaining = master ? 0 : grandTotal - (Number(paid) || 0); // المبلغ المتبقي
  const totalDebt = master ? (subscriber.carry ?? 0) : (subscriber.carry ?? 0) + remaining; // مجموع الديون بعد هذا التفعيل

  // تاريخ بدء الاشتراك المعروض في حقل "من"
  const startDate = (() => {
    const now = new Date();
    return subscriber.dateTo && new Date(subscriber.dateTo) > now ? new Date(subscriber.dateTo) : now;
  })();

  // إعادة حساب تاريخ الانتهاء الطبيعي عند تغيير عدد الأشهر (ما لم يكن التعديل يدوياً)
  useEffect(() => {
    if (manualDate) return;
    const now = new Date();
    const start = subscriber.dateTo && new Date(subscriber.dateTo) > now ? new Date(subscriber.dateTo) : now;
    setExpiry(toInputDate(computeDateTo(start, months || 1, tower?.activationMode)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, manualDate]);
  const directLink = sasDirectUrl(tower, subscriber);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);

  // تسجيل الدخول التلقائي للوحة SAS4 المضمّنة عبر البروكسي (نفس origin) ثم تحميلها.
  // يعمل محلياً وعلى الموقع المنشور معاً؛ وعند تعذّره يُفتح الرابط المباشر كبديل.
  useEffect(() => {
    let active = true;
    const proxied = sasUrl(subscriber);
    if (!subscriber.towerId || !proxied) { setFrameSrc(directLink); return; }
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

  // حفظ التفعيل — print=true يفتح وصل الطباعة بعد الحفظ
  async function confirm(print = false) {
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
          master,
          note: note || null,
          dueDate: dueDate || null,
          paymentMethod: paymentMethod || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل التفعيل"); return; }
      if (print && data.entryId) window.open(`/subscriptions/${data.entryId}/receipt`, "_blank");
      onDone();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setSaving(false); }
  }

  // فتح صفحة تفعيل الساس (نافذة جديدة)
  function openSasPage() {
    if (directLink) window.open(directLink, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-3" onClick={releaseAndClose}>
      {/* إشعار كبير وسط الشاشة: هذا المشترك محوّل إلى يوزر جديد */}
      {subscriber.transferredTo && !transferSeen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-5xl">🔁</div>
            <h2 className="mb-2 text-2xl font-extrabold text-amber-700">تنبيه: مشترك محوّل</h2>
            <p className="mb-1 text-lg text-slate-700">هذا المشترك قد تحوّل إلى اليوزر:</p>
            <p className="mb-4 text-2xl font-extrabold text-slate-900" dir="ltr">{subscriber.transferredTo}</p>
            <button onClick={() => setTransferSeen(true)} className="w-full rounded-xl bg-mynet-blue py-3 text-lg font-bold text-white hover:bg-mynet-blue-dark">فهمت، متابعة التفعيل</button>
          </div>
        </div>
      )}

      <div className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* الترويسة */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <h3 className="text-base font-bold text-slate-800">تفعيل الاشتراك</h3>
          <button onClick={releaseAndClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* صفحة SAS4 مضمّنة (أعلى على الهاتف / يسار على الكمبيوتر) */}
          <div className="flex h-[42vh] shrink-0 flex-col border-b border-slate-200 md:h-auto md:flex-1 md:border-b-0 md:border-l">
            <div className="flex items-center justify-between bg-slate-100 px-3 py-1.5 text-xs">
              <span className="font-semibold text-slate-600">صفحة تفعيل المشترك في SAS4 (دخول تلقائي)</span>
              {directLink && <a href={directLink} target="_blank" rel="noopener noreferrer" className="text-mynet-blue hover:underline">فتح بنافذة جديدة ↗</a>}
            </div>
            {frameSrc ? (
              <iframe
                src={frameSrc}
                className="flex-1 border-0"
                title="SAS4 activation"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                {subscriber.sasId ? "جاري تسجيل الدخول التلقائي..." : "هذا المشترك غير مربوط بـ SAS4"}
              </div>
            )}
          </div>

          {/* نموذج التفعيل (أسفل على الهاتف / يمين على الكمبيوتر) */}
          <div className="w-full shrink-0 space-y-2 bg-slate-50 p-3 md:w-[380px] md:overflow-y-auto">
            {/* المشترك */}
            <div className="rounded-lg bg-white px-3 py-2 text-center text-sm font-bold text-red-600 shadow-sm">
              المشترك: {subscriber.name ?? "—"}
            </div>

            <Field label="اليوزر">
              <div className="w-full truncate rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm font-semibold text-slate-700" dir="ltr">{subscriber.netUser ?? "—"}</div>
            </Field>

            <Field label="فئة الاشتراك">
              <select value={packageId} onChange={(e) => setPackageId(Number(e.target.value) || "")} className="w-full rounded border border-slate-300 bg-yellow-50 px-2 py-1.5 text-sm font-bold">
                <option value="">— اختر الفئة —</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({fmt(p.priceDinar)})</option>)}
              </select>
            </Field>

            <Field label="عدد الاشهر">
              <div className="flex items-center gap-1">
                <button onClick={() => setMonths((m) => Math.max(1, m - 1))} className="h-8 w-8 shrink-0 rounded bg-slate-200 text-lg font-bold hover:bg-slate-300">−</button>
                <input type="number" min={1} value={months} onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-center text-sm" />
                <button onClick={() => setMonths((m) => m + 1)} className="h-8 w-8 shrink-0 rounded bg-slate-200 text-lg font-bold hover:bg-slate-300">+</button>
              </div>
            </Field>

            {/* تاريخ التفعيل */}
            <div className="mt-1 border-t border-slate-200 pt-1.5 text-center text-xs font-bold text-slate-500">تاريخ التفعيل</div>
            <Field label="من">
              <div className="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm text-slate-600" dir="ltr">{toInputDate(startDate)}</div>
            </Field>
            <Field label="الى">
              <div className="flex items-center gap-1">
                <input type="date" value={expiry} disabled={!manualDate} onChange={(e) => setExpiry(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500" dir="ltr" />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500" title="تعديل يدوي للتاريخ">
                  <input type="checkbox" checked={manualDate} onChange={(e) => setManualDate(e.target.checked)} className="h-4 w-4 accent-mynet-blue" />
                  يدوي
                </label>
              </div>
            </Field>

            <Field label="كلفة الاشتراك">
              <div className="flex gap-1">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(packageTotal)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                {amount !== "" && <button onClick={() => setAmount("")} title="رجوع لسعر الباقة" className="shrink-0 rounded bg-slate-200 px-2 text-sm hover:bg-slate-300">↺</button>}
              </div>
            </Field>

            <Field label="اجور صيانة">
              <input type="number" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="0" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </Field>

            <Field label="المجموع">
              <div className="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm font-bold text-slate-800">{fmt(grandTotal)}</div>
            </Field>

            <Field label="المبلغ الواصل">
              <div className="flex gap-1">
                <input type="number" value={master ? String(grandTotal) : paid} disabled={master} onChange={(e) => setPaid(e.target.value)} className="w-full rounded border border-slate-300 bg-sky-50 px-2 py-1.5 text-sm font-semibold disabled:bg-slate-100" />
                <button onClick={() => setPaid(String(grandTotal))} disabled={!grandTotal || master} title="إدخال المجموع" className="shrink-0 rounded bg-emerald-600 px-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">➕</button>
              </div>
            </Field>

            <Field label="المبلغ المتبقي">
              <div className={`w-full rounded border px-2 py-1.5 text-sm font-bold ${remaining > 0 ? "border-red-200 bg-red-50 text-red-600" : "border-emerald-200 bg-emerald-50 text-emerald-600"}`}>{fmt(remaining)}</div>
            </Field>

            <Field label="مجموع الديون">
              <div className="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm font-bold text-slate-700">{fmt(totalDebt)}</div>
            </Field>

            {/* ماستر: واصل كامل بلا دين، بحساب مستقل عن التقرير اليومي */}
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${master ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600"}`}>
              <input type="checkbox" checked={master} onChange={(e) => setMaster(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
              🅜 ماستر — واصل كامل بلا دين، بحساب مستقل
            </label>

            <Field label="موعد التسديد">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" dir="ltr" />
            </Field>

            <Field label="طريقة الدفع">
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>

            <Field label="ملاحظة">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </Field>

            {/* حالة الكارت المسحوب */}
            {card?.serial && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-emerald-700">الكارت منسوخ ✓ — الصقه بصفحة SAS4</span>
                  <span className="text-slate-400">متاح: {available}</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-white px-2 py-1.5 text-base font-bold tracking-wider text-slate-800" dir="ltr">{card.serial}</code>
                  <button onClick={() => copy(card.serial)} className="rounded bg-slate-200 px-2 py-1.5 text-sm hover:bg-slate-300" title="نسخ">📋{copied ? "✓" : ""}</button>
                </div>
              </div>
            )}

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

            {/* أزرار الإجراءات */}
            <div className="space-y-1.5 border-t border-slate-200 pt-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => confirm(true)} disabled={saving} className="rounded-lg bg-mynet-blue py-2 text-sm font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">💾 حفظ وطباعة الوصل</button>
                <button onClick={pullCard} disabled={loadingCard || !packageId} className="rounded-lg bg-amber-500 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">{loadingCard ? "..." : `🎴 سحب بطاقة${available ? ` (${available})` : ""}`}</button>
                <button onClick={openSasPage} disabled={!directLink} className="rounded-lg bg-slate-600 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">🌐 صفحة التفعيل</button>
                <button onClick={() => confirm(false)} disabled={saving} className="rounded-lg bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? "جاري..." : "✅ حفظ و اغلاق"}</button>
              </div>
              <button onClick={releaseAndClose} className="w-full rounded-lg bg-slate-100 py-2 text-sm text-slate-600 hover:bg-slate-200">اغلاق</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// صف حقل: التسمية يميناً والقيمة/الإدخال يساراً (تخطيط كلاسيكي)
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-right text-xs font-semibold text-slate-600">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
