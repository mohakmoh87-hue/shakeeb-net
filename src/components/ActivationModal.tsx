"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareSasEmbed } from "@/lib/sasEmbed";
import { localSasBase } from "@/lib/localSas";
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
  const [masterAmount, setMasterAmount] = useState(""); // دفع مختلط: مبلغ الماستر (فارغ = كامل المبلغ ماستر)
  const [months, setMonths] = useState(1); // عدد الأشهر (افتراضي 1)
  const [amount, setAmount] = useState(""); // كلفة الاشتراك يدوياً (فارغ = سعر الباقة × الأشهر)
  const [delivery, setDelivery] = useState(""); // اجور صيانة/توصيل (تُضاف على مبلغ الاشتراك)
  const [note, setNote] = useState(""); // ملاحظة الوصل
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
  const [actOffice, setActOffice] = useState(false); // «مكتب تفعيل»: واصل كامل + مصروف على الحساب
  const [actAccountId, setActAccountId] = useState<number | "">(""); // الحساب المختار
  const [actAccounts, setActAccounts] = useState<{ id: number; name: string | null }[]>([]); // حسابات «مكتب تفعيل»

  // جلب حسابات «مكتب التفعيل» (المُعلَّمة isActivationOffice) لعرضها في القائمة المنسدلة
  useEffect(() => {
    fetch("/api/accounts").then((r) => (r.ok ? r.json() : [])).then((list) => {
      const offs = (Array.isArray(list) ? list : []).filter((a: { isActivationOffice?: boolean }) => a.isActivationOffice)
        .map((a: { id: number; name: string | null }) => ({ id: a.id, name: a.name }));
      setActAccounts(offs);
    }).catch(() => {});
  }, []);

  const pkg = packages.find((p) => p.id === packageId);
  const packagePrice = pkg?.priceDinar ?? 0;
  const packageTotal = packagePrice * (months || 1); // إجمالي سعر الباقة لعدد الأشهر
  const price = amount !== "" ? Number(amount) || 0 : packageTotal; // كلفة الاشتراك الفعلية
  const deliveryAmount = Number(delivery) || 0; // اجور صيانة
  const grandTotal = price + deliveryAmount; // المجموع المستحق
  // ماستر أو «مكتب تفعيل»: واصل كامل بلا دين جديد (يبقى دين المشترك السابق كما هو)
  const fullPaid = master || actOffice;
  // دفع مختلط: مبلغ ماستر جزئي والباقي نقدي — يُحسب النقدي تلقائياً ليبقى الوصل كاملاً بلا دين
  const mixed = master && (Number(masterAmount) || 0) > 0;
  const masterPart = master ? (mixed ? Number(masterAmount) || 0 : grandTotal) : 0;
  const cashPart = mixed ? Math.max(0, grandTotal - masterPart) : 0;
  const remaining = fullPaid ? 0 : grandTotal - (Number(paid) || 0); // المبلغ المتبقي
  const totalDebt = fullPaid ? (subscriber.carry ?? 0) : (subscriber.carry ?? 0) + remaining; // مجموع الديون بعد هذا التفعيل

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
  const [localBase, setLocalBase] = useState<string>("");

  useEffect(() => { localSasBase().then(setLocalBase); }, []);

  // تسجيل الدخول التلقائي للوحة SAS4 المضمّنة ثم تحميلها.
  // إن وُجد العامل المحلي (حاسبة المكتب) تُحمَّل منه مباشرةً (أسرع، يحقن التوكن تلقائياً)؛
  // وإلا عبر بروكسي الموقع؛ وعند تعذّره الرابط المباشر.
  useEffect(() => {
    let active = true;
    if (!subscriber.towerId || !subscriber.sasId) { setFrameSrc(directLink); return; }
    if (localBase) {
      setFrameSrc(`${localBase}/sas/${subscriber.towerId}#/user/activate/${subscriber.sasId}`);
      return;
    }
    const proxied = sasUrl(subscriber);
    if (!proxied) { setFrameSrc(directLink); return; }
    prepareSasEmbed(subscriber.towerId).then((ok) => {
      if (active) setFrameSrc(ok ? proxied : directLink);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber.id, localBase]);

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
    if (actOffice && !actAccountId) { setError("اختر «مكتب التفعيل» من القائمة"); return; }
    if (mixed && masterPart > grandTotal) { setError("مبلغ الماستر أكبر من المجموع"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/subscribers/${subscriber.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId,
          cardId: card?.id ?? null,
          paid: master ? cashPart : Number(paid) || 0,
          masterAmount: mixed ? masterPart : 0,
          months: months || 1,
          totalOverride: amount !== "" ? Number(amount) || 0 : null,
          delivery: deliveryAmount,
          dateToOverride: expiry || null,
          master,
          activationAccountId: actOffice && actAccountId ? actAccountId : null,
          note: note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل التفعيل"); return; }
      // طباعة مباشرة بلا فتح أي تاب: أمر طباعة صامتة تلتقطه حاسبة مكتب المشترك فوراً
      if (print && data.entryId) {
        void fetch("/api/print", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "subscription", id: data.entryId }),
        }).catch(() => {});
      }
      onDone();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setSaving(false); }
  }

  return (
    // لا إغلاق بالنقر على الخلفية: النافذة تُغلق حصراً بأزرارها (حفظ وطباعة / حفظ و اغلاق / اغلاق / ✕)
    // — نقرة سهو خارجها كانت تُغلقها أثناء التفعيل على SAS فيضيع الكارت المسحوب
    <div className="nst ov">
      {/* إشعار كبير وسط الشاشة: هذا المشترك محوّل إلى يوزر جديد */}
      {subscriber.transferredTo && !transferSeen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-7 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-5xl">🔁</div>
            <h2 className="mb-2 text-2xl font-extrabold text-amber-700">تنبيه: مشترك محوّل</h2>
            <p className="mb-1 text-lg text-slate-700">هذا المشترك قد تحوّل إلى اليوزر:</p>
            <p className="mb-4 text-2xl font-extrabold text-slate-900" dir="ltr">{subscriber.transferredTo}</p>
            <button onClick={() => setTransferSeen(true)} className="w-full rounded-xl bg-mynet-blue py-3 text-lg font-bold text-white hover:bg-mynet-blue-dark">فهمت، متابعة التفعيل</button>
          </div>
        </div>
      )}

      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sh-head">
          <div className="shh-l">
            <h3>تفعيل الاشتراك</h3>
            <span className="shh-sep" />
            <span className="shh-nm">{subscriber.name ?? "—"}</span>
            {subscriber.netUser && <span className="shh-us" dir="ltr">{subscriber.netUser}</span>}
          </div>
          <button className="xbtn" onClick={releaseAndClose} aria-label="إغلاق">✕</button>
        </div>

        <div className="sh-body">
          <div className="fpane">
            {/* 1) البطاقة والسيريال */}
            <div className="cbox">
              <div className="cbox-row">
                <button className="pull" onClick={pullCard} disabled={loadingCard || !packageId}>{loadingCard ? "..." : "🎴 سحب بطاقة"}</button>
                <div className="ser">{card?.serial ?? "— — — —"}</div>
                <button className="cpy" onClick={() => copy(card?.serial ?? null)} title="نسخ السيريال">{copied ? "✓" : "📋"}</button>
                <div className="rem">المتبقي<br /><b>{available}</b></div>
              </div>
            </div>

            {/* 2) الفئة والتاريخ */}
            <div className="g2">
              <div className="fld"><label>فئة الاشتراك</label>
                <select className="pkg" value={packageId} onChange={(e) => setPackageId(Number(e.target.value) || "")}>
                  <option value="">— اختر الفئة —</option>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({fmt(p.priceDinar)})</option>)}
                </select>
              </div>
              <div className="fld"><label>تاريخ الانتهاء</label>
                <div className="dw">
                  <input type="date" value={expiry} disabled={!manualDate} onChange={(e) => setExpiry(e.target.value)} dir="ltr" />
                  <span className="chk"><input type="checkbox" checked={manualDate} onChange={(e) => setManualDate(e.target.checked)} /> يدوي</span>
                </div>
              </div>
            </div>

            {/* 3) الأشهر والكلفة والتوصيل */}
            <div className="g3">
              <div className="fld"><label>عدد الأشهر</label>
                <div className="stp">
                  <button onClick={() => setMonths((m) => Math.max(1, m - 1))}>−</button>
                  <input type="number" min={1} value={months} onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))} dir="ltr" style={{ textAlign: "center" }} />
                  <button onClick={() => setMonths((m) => m + 1)}>+</button>
                </div>
              </div>
              <div className="fld"><label>كلفة الاشتراك</label>
                <div className="inl">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(packageTotal)} dir="ltr" />
                  <button className="mb" title="رجوع لسعر الباقة" onClick={() => setAmount("")} disabled={amount === ""}>↺</button>
                </div>
              </div>
              <div className="fld"><label>اجور توصيل</label>
                <input type="number" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="0" dir="ltr" />
              </div>
            </div>

            {/* 4) المجاميع كبطاقات ملوّنة */}
            <div className="money">
              <div className="mcard m-tot"><small>المجموع</small><b>{fmt(grandTotal)}</b></div>
              <div className="mcard m-paid">
                <small>المبلغ الواصل</small>
                <div className="mp-in">
                  <input type="number" value={fullPaid ? String(mixed ? cashPart : grandTotal) : paid} disabled={fullPaid} onChange={(e) => setPaid(e.target.value)} dir="ltr" />
                  <button className="mb go" title="إدخال المجموع" onClick={() => setPaid(String(grandTotal))} disabled={!grandTotal || fullPaid}>➕</button>
                </div>
              </div>
              <div className="mcard m-rem"><small>المبلغ المتبقي</small><b>{fmt(remaining)}</b></div>
              <div className="mcard m-debt"><small>مجموع الديون</small><b>{fmt(totalDebt)}</b></div>
            </div>

            {/* 5) الماستر ومكتب التفعيل — حصريان */}
            <div className="opts">
              <label className={`tog ${master ? "on" : ""}`}>
                <input type="checkbox" checked={master} onChange={(e) => { setMaster(e.target.checked); setMasterAmount(""); if (e.target.checked) { setActOffice(false); setActAccountId(""); } }} />
                <span>🅜 ماستر</span>
              </label>
              {actAccounts.length > 0 && (
                <>
                  <label className={`tog ${actOffice ? "on" : ""}`}>
                    <input type="checkbox" checked={actOffice} onChange={(e) => { setActOffice(e.target.checked); if (e.target.checked) setMaster(false); else setActAccountId(""); }} />
                    <span>🏢 مكتب تفعيل</span>
                  </label>
                  <select className="acct" disabled={!actOffice} value={actAccountId} onChange={(e) => setActAccountId(Number(e.target.value) || "")}>
                    <option value="">— اختر الحساب —</option>
                    {actAccounts.map((a) => <option key={a.id} value={a.id}>{a.name ?? `#${a.id}`}</option>)}
                  </select>
                </>
              )}
            </div>
            {/* الدفع المختلط: مبلغ ماستر جزئي والباقي نقدي يُحسب تلقائياً (أ4) */}
            {master && (
              <div className="fld">
                <label>مبلغ الماستر (فارغ = كامل المبلغ ماستر)</label>
                <input type="number" value={masterAmount} onChange={(e) => setMasterAmount(e.target.value)} placeholder={String(grandTotal)} dir="ltr" />
              </div>
            )}
            {master && (
              <div className="hint">
                {mixed
                  ? `🅜 مختلط: ماستر ${fmt(masterPart)} + نقدي ${fmt(cashPart)} — واصل كامل بلا دين`
                  : "🅜 ماستر: واصل كامل بحساب الماستر المستقل. اكتب مبلغاً جزئياً والباقي يُحسب نقدياً تلقائياً"}
              </div>
            )}
            {actOffice && (
              <div className="hint">🏢 مكتب تفعيل: واصل كامل بلا دين + يُسجَّل مبلغ الاشتراك مصروفاً على هذا الحساب (يتعادل التقرير).</div>
            )}

            {/* 6) ملاحظة */}
            <div className="fld"><label>ملاحظة</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="تظهر على الوصل المطبوع…" />
            </div>

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</div>}

            {/* 7) الأزرار */}
            <div className="acts">
              <button className="bs b1" onClick={() => confirm(true)} disabled={saving}>💾 حفظ وطباعة</button>
              <button className="bs b2" onClick={() => confirm(false)} disabled={saving}>{saving ? "جاري..." : "✅ حفظ و اغلاق"}</button>
              <button className="bs b3 wide" onClick={releaseAndClose}>اغلاق</button>
            </div>
          </div>

          {/* صفحة SAS4 مضمّنة — يسار على الكمبيوتر / أسفل على الهاتف */}
          <div className="spane">
            <div className="sbar">
              <b>صفحة تفعيل المشترك في SAS4 (دخول تلقائي)</b>
              {directLink && <a href={directLink} target="_blank" rel="noopener noreferrer">فتح بنافذة جديدة ↗</a>}
            </div>
            <div className="sbody">
              {frameSrc ? (
                <ScaledSasFrame src={frameSrc} title="SAS4 activation" />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
                  {subscriber.sasId ? "جاري تسجيل الدخول التلقائي..." : "هذا المشترك غير مربوط بـ SAS4"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// إطار SAS4 مضمّن. على الهاتف: لوحة SAS مصمّمة لعرض مكتبي أوسع من الشاشة،
// فتخرج لليسار (RTL) ولا يمكن رؤيتها؛ لذا نصغّر الصفحة كاملةً لتناسب عرض الحاوية.
// على الكمبيوتر: تُعرض بحجمها الكامل مع تمرير داخلي (كما كانت).
function ScaledSasFrame({ src, title }: { src: string; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onMq = () => setIsMobile(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const LOGICAL = 1024; // العرض المنطقي لصفحة SAS المكتبية
  const scale = isMobile && box && box.w > 0 ? box.w / LOGICAL : 1;
  const scaled = scale < 1 && !!box;

  return (
    <div ref={wrapRef} className="relative flex-1 overflow-hidden bg-white">
      <iframe
        src={src}
        title={title}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        style={
          scaled && box
            ? {
                position: "absolute",
                top: 0,
                right: 0,
                width: LOGICAL,
                height: box.h / scale,
                transform: `scale(${scale})`,
                transformOrigin: "top right",
                border: 0,
              }
            : { width: "100%", height: "100%", border: 0 }
        }
      />
    </div>
  );
}

// صف حقل: التسمية يميناً والقيمة/الإدخال يساراً (تخطيط كلاسيكي)
