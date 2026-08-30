"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareSasEmbed } from "@/lib/sasEmbed";
import { sasScopedPath } from "@/lib/sasScope";
import { useLocalSasBase } from "./localSas";
import { computeDateTo } from "@/lib/subscription";
import { announceMoneyChanged } from "@/lib/moneyRefresh";

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
  transferredFrom?: string | null;
  // 🔴 بلاغُ صميم 2026-08-13: «يفتح لوحةَ الساس ويضع الكارت ويضغط تفعيل فيظهر Access
  //   Denied من الساس نفسِه». والسببُ أنّ هذا النوعَ كان **بلا لوحة**: فتُفتَح اللوحةُ
  //   برمزِ **أعمدةِ المكتب** — وهي أعمدةُ اللوحة الأولى — بينما المشتركُ على اللوحة
  //   الثانية، فيرفض الساسُ العمليّةَ لأنّ الحسابَ المُسجَّلَ لا يملك ذلك المستخدم.
  sasPanelId?: number | null;
};

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

// رابط صفحة تفعيل المشترك عبر البروكسي (نفس origin + دخول تلقائي)
function sasUrl(sub: ActSubscriber): string | null {
  if (!sub.towerId || !sub.sasId) return null;
  // 🔴 اللوحةُ في الرابط: بلاها يفتح الوسيطُ حسابَ اللوحة الأولى فيردّ الساسُ
  //   «Access Denied» على مشتركِ اللوحة الثانية (بلاغُ صميم).
  // 🔑 واللوحةُ في **المسار** لا في المعامل: المسارُ ملكُ التبويب ويورَّث لكلّ طلبٍ
  //   نسبيّ، أمّا المعاملُ فيسقط بعد أوّل تحميلٍ فتعود اللوحةُ للخانة المشتركة.
  return sasScopedPath(sub.towerId, sub.sasPanelId, `user/activate/${sub.sasId}`);
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
  // فشلُ النسخ (سفاري iOS) — يُظهر السيريال للنسخ اليدويّ بدل الصمت
  const [copyFail, setCopyFail] = useState(false);
  // ضاع حجزُ الكارت (أخذه ساحبٌ آخر) — يُنبَّه فوراً لا عند الحفظ
  const [holdLost, setHoldLost] = useState(false);
  const [loadingCard, setLoadingCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [transferSeen, setTransferSeen] = useState(false); // إشعار التحويل يظهر عند كل فتح للتفعيل
  const [actOffice, setActOffice] = useState(false); // «مكتب تفعيل»: واصل كامل + مصروف على الحساب
  const [actAccountId, setActAccountId] = useState<number | "">(""); // الحساب المختار
  const [actAccounts, setActAccounts] = useState<{ id: number; name: string | null }[]>([]); // حسابات «مكتب تفعيل»
  // ═════ 🛡️ حارسُ «اليوزر المختلف» (طلب محمد 2026-08-21 — حالة bg-7-4-2@mu) ═════
  // صفحةُ الساس تُفتح بالرقم (sasId) — فرقمٌ معكوسٌ يفتح يوزراً آخر والمالُ يذهب لغير
  // صاحبه. يُسأل الخادمُ عن يوزرِ صاحبِ الرقم: اختلافٌ ⇒ إنذارٌ أحمرُ يحجب سحبَ الكارت
  // والحفظَ حتى صحِّ الإقرار. (والخادمُ يعيد الفحصَ حكماً في مسار التفعيل — 409 بدونه.)
  const [sasIdent, setSasIdent] = useState<{ checked: boolean; match: boolean; ourUser?: string | null; sasUser?: string | null } | null>(null);
  const [mismatchOk, setMismatchOk] = useState(false);
  useEffect(() => {
    if (!subscriber.sasId) return;
    fetch(`/api/subscribers/${subscriber.id}/sas-identity`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.match === "boolean") setSasIdent(d); })
      .catch(() => {});
  }, [subscriber.id, subscriber.sasId]);
  // الحجبُ عند اختلافٍ **مُثبَت** بلا إقرار — تعذُّرُ الفحص لا يحجب (عطلُ اتصالٍ لا يعطّل مكتباً)
  const mismatchBlock = sasIdent?.checked === true && sasIdent.match === false && !mismatchOk;

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
  // فشلُ تهيئة إطار الساس — يُعرَض سببُه بدل ارتدادٍ أخرسَ إلى الساس الخام
  const [embedErr, setEmbedErr] = useState<string | null>(null);
  const [embedTry, setEmbedTry] = useState(0); // عدّادُ «إعادة محاولة» — يُعيد تشغيل التأثير
  // 🔁 جسٌّ يُعيد المحاولة: جسّةٌ واحدةٌ فاشلة (لحظةَ إعادة تشغيل العامل) كانت تُبقي
  //    هذه النافذةَ على المسار السحابيّ البطيء حتى تُحدَّث الصفحة يدويّاً
  const localBase = useLocalSasBase();

  // تسجيل الدخول التلقائي للوحة SAS4 المضمّنة ثم تحميلها.
  // إن وُجد العامل المحلي (حاسبة المكتب) تُحمَّل منه مباشرةً (أسرع، يحقن التوكن تلقائياً)؛
  // وإلا عبر بروكسي الموقع؛ وعند تعذّره الرابط المباشر.
  useEffect(() => {
    let active = true;
    if (!subscriber.towerId || !subscriber.sasId) { setFrameSrc(directLink); return; }
    if (localBase) {
      // العاملُ المحليُّ يحقن الرمزَ بنفسه — فيجب أن يعرف **أيَّ لوحةٍ** يُسجّل بها
      setFrameSrc(localBase + sasScopedPath(subscriber.towerId, subscriber.sasPanelId, `user/activate/${subscriber.sasId}`));
      return;
    }
    const proxied = sasUrl(subscriber);
    if (!proxied) { setFrameSrc(directLink); return; }
    // ═════ 🔴 لا سقوطَ صامتاً إلى الساس الخام (بلاغُ عليّ البياتي 2026-08-19) ═════
    // كان فشلُ التهيئة يُحمّل `directLink` — أي **خادمَ الساس الخام داخل الإطار**.
    // والساسُ الخام في إطارٍ لا جلسةَ له ولا يقبل الدخولَ العميق ⇒ يرتدّ إلى صفحته
    // الرئيسيّة/الدخول، فيرى المستخدم «صفحةَ التفعيل لا تثبت وتخرج» **بلا أيّ أثرٍ
    // يقول لماذا** — لا هو يعرف ولا نحن. فالإبدالُ الأخرسُ أخفى العلّةَ الحقيقيّة.
    // 🔑 الآن: الفشلُ يوقف التحميلَ ويعرض سببَه الحرفيَّ داخل النافذة، مع «إعادة
    //   محاولة» و«فتح بنافذة جديدة» (النافذةُ المستقلّةُ يصلح فيها الساسُ الخام).
    setEmbedErr(null);
    prepareSasEmbed(subscriber.towerId, subscriber.sasPanelId).then((r) => {
      if (!active) return;
      if (r.ok) setFrameSrc(proxied);
      else { setFrameSrc(null); setEmbedErr(r.reason); }
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber.id, localBase, embedTry]);

  // ═════ 🔴 «الكارت ميصيرله نسخ» في متصفّح الأيفون (بلاغُ محمد 2026-08-19) ═════
  // سفاري iOS يمنح `navigator.clipboard.writeText` **فقط داخل لمسةِ المستخدم مباشرةً**.
  // والسحبُ ينسخ **بعد `await fetch`** ⇒ اللمسةُ انتهت فيرفض المتصفّح النسخ. ومعه علّةٌ
  // ثانيةٌ أسوأ: الفشلُ كان **مبتلَعاً صامتاً** (`() => {}`) وحتى `?.` تبتلع غيابَ الواجهة
  // كلَّها ⇒ المستخدم يضغط ولا يحدث شيءٌ ولا يُقال له لماذا.
  // 🔑 والعلاج ثلاثيّ: بديلٌ قديمٌ يعمل على iOS (`execCommand` على حقلٍ مُحدَّد)، ثمّ
  //   إظهارُ السيريال للنسخ اليدويّ إن فشل الاثنان — فلا يبقى المستخدم أمام زرٍّ أخرس.
  const copy = useCallback((serial: string | null) => {
    if (!serial) return;
    const ok = () => { setCopied(true); setCopyFail(false); setTimeout(() => setCopied(false), 1500); };
    // البديلُ المتوافق مع سفاري iOS — يعمل ما دام في سياق حدثٍ، ولا يحتاج أذوناً
    const legacy = (): boolean => {
      try {
        const ta = document.createElement("textarea");
        ta.value = serial;
        ta.setAttribute("readonly", "");
        // خارج الشاشة بلا تمريرٍ مفاجئ، و`contentEditable` شرطُ التحديد على iOS
        ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
        ta.contentEditable = "true";
        document.body.appendChild(ta);
        const range = document.createRange();
        range.selectNodeContents(ta);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        ta.setSelectionRange(0, serial.length);
        const done = document.execCommand("copy");
        document.body.removeChild(ta);
        return done;
      } catch { return false; }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(serial).then(ok, () => { if (legacy()) ok(); else setCopyFail(true); });
      return;
    }
    if (legacy()) ok(); else setCopyFail(true);
  }, []);

  // ═════ 🔴 نبضةُ حجز الكارت (بلاغُ محمد 2026-08-19) ═════
  // الحجزُ ينتهي بعد ٥ دقائق، ومَن يُفعّل على لوحة الساس أوّلاً يتجاوزها بكثير ⇒
  // يعود ليحفظ فيجد كارتَه «رجع للمخزن» وقد أخذه ساحبٌ آخر. فما دامت النافذةُ
  // مفتوحةً والكارتُ في اليد، تُجدَّد لحظةُ الحجز كلَّ دقيقتَين (نصفُ المهلة).
  // وحين تُغلق النافذةُ تتوقّف النبضةُ فينتهي الحجزُ وحدَه — فلا كارتَ يُحبَس أبداً.
  useEffect(() => {
    const id = card?.id;
    if (!id) return;
    let alive = true;
    const beat = () => {
      fetch("/api/recharge-cards/hold", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: id }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          // ضاع الحجزُ فعلاً (انتهى قبل أوّل نبضةٍ وأخذه غيرُك) — يُقال صراحةً بدل
          // أن يكتشفه المستخدمُ عند الحفظ بكارتٍ ليس له
          if (alive && d && d.held === false) setHoldLost(true);
        })
        .catch(() => {});
    };
    const t = window.setInterval(beat, 120000);
    return () => { alive = false; window.clearInterval(t); };
  }, [card?.id]);

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
    if (mismatchBlock) { setError("يوزرُ الساس مختلفٌ عن يوزر المشترك — ضع صحَّ الإقرار أعلى النافذة أوّلاً"); return; }
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
          confirmUserMismatch: mismatchOk, // 🛡️ إقرارُ اختلاف اليوزر — الخادمُ يرفض بدونه عند الاختلاف
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 🛡️ الخادمُ أثبت اختلافَ اليوزر (وربّما فشل فحصُ الواجهة لعطلٍ عابر) ⇒ يظهر الإنذار
        if (data.userMismatch) { setSasIdent({ checked: true, match: false, ourUser: data.ourUser, sasUser: data.sasUser }); setMismatchOk(false); }
        setError(data.error ?? "فشل التفعيل"); return;
      }
      announceMoneyChanged(); // بطاقات الرئيسية (التقرير/المصروفات/المبيع) تتحدّث فوراً
      // 🔴 عالٍ · الطباعةُ لم تعد صامتةً (اصطاده الفحصُ العدائيّ 2026-08-19):
      //   كانت `void fetch(...).catch(() => {})` ثمّ onDone فوراً ⇒ فشلُ الطباعة أو انقطاعُ
      //   حاسبةِ المكتب لا يُقال أبداً، ومسارُ التفعيل (وصلٌ ماليّ) هو الأكثرُ استخداماً وحدَه
      //   الأخرس. الآن: يُنتظَر ردُّ الطباعة ويُبلَّغ إن تعذّرت — **بلا منعِ الإغلاق** (المالُ
      //   حُفظ سلفاً، فالطباعةُ تالية). كنمط صفحة الفواتير التي تفحص ok/workerOnline.
      if (print && data.entryId) {
        try {
          const pr = await fetch("/api/print", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "subscription", id: data.entryId }),
          });
          const pd = await pr.json().catch(() => ({}));
          if (!pr.ok) alert(`✓ حُفظ التفعيل — لكن تعذّرت الطباعة: ${pd.error ?? "خطأ"}`);
          else if (pd.workerOnline === false) alert("✓ حُفظ التفعيل — حاسبةُ المكتب غير متصلةٍ للطباعة الآن، سيُطبع الوصلُ عند تشغيلها");
        } catch { alert("✓ حُفظ التفعيل — تعذّر إرسالُ أمر الطباعة (تحقّق من الاتصال)"); }
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
            <h2 className="mb-3 text-2xl font-extrabold text-amber-700">تنبيه: مشترك محوّل</h2>
            <p className="mb-1 text-base text-slate-600">حُوّل من الاشتراك:</p>
            <p className="mb-3 text-xl font-extrabold text-slate-500 line-through" dir="ltr">{subscriber.transferredFrom ?? "—"}</p>
            <p className="mb-1 text-base text-slate-600">إلى الاشتراك:</p>
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
            {/* 🛡️ اختلافُ اليوزر بين البرنامج والساس — لا سحبَ ولا تفعيلَ قبل الإقرار */}
            {sasIdent?.checked === true && sasIdent.match === false && (
              <div className="mb-2 rounded-xl border-2 border-red-500 bg-red-50 px-3 py-2">
                <div className="text-[13px] font-extrabold leading-6 text-red-700">
                  ⚠️ صفحةُ الساس مفتوحةٌ على يوزرٍ مختلف!
                </div>
                <div className="text-[12px] leading-6 text-red-700">
                  يوزر البرنامج: <b dir="ltr">{sasIdent.ourUser}</b> · يوزر الساس لهذا الربط: <b dir="ltr">{sasIdent.sasUser}</b>
                  <br />أيُّ تفعيلٍ أو كارتٍ الآن سيذهب لحساب <b dir="ltr">{sasIdent.sasUser}</b> في الساس — تأكّد قبل المتابعة.
                </div>
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-[12px] font-bold text-red-800">
                  <input type="checkbox" className="h-4 w-4" checked={mismatchOk} onChange={(e) => setMismatchOk(e.target.checked)} />
                  أُدرك أنّ اليوزرَين مختلفان وأوافق على المتابعة رغم ذلك
                </label>
              </div>
            )}
            {/* 1) البطاقة والسيريال */}
            <div className="cbox">
              <div className="cbox-row">
                <button className="pull" onClick={pullCard} disabled={loadingCard || !packageId || mismatchBlock}
                  title={mismatchBlock ? "يوزرُ الساس مختلف — ضع صحَّ الإقرار أوّلاً" : undefined}>{loadingCard ? "..." : "🎴 سحب بطاقة"}</button>
                {/* السيريالُ قابلٌ للتحديد باللمس — على iOS يبقى هذا آخرَ طريقٍ مضمونٍ للنسخ */}
                <div className="ser" style={{ userSelect: "all", WebkitUserSelect: "all" }}>{card?.serial ?? "— — — —"}</div>
                <button className="cpy" onClick={() => copy(card?.serial ?? null)} title="نسخ السيريال">{copied ? "✓" : "📋"}</button>
                <div className="rem">المتبقي<br /><b>{available}</b></div>
              </div>
              {/* 🍏 فشلُ النسخ (سفاري iOS يرفضه خارج لمسةِ المستخدم): يُقال صراحةً بدل الصمت */}
              {/* ⚠️ ضاع الحجز: يُقال الآن لا عند الحفظ — فيسحب المستخدمُ كارتاً بديلاً بوعي */}
              {holdLost && (
                <div className="mt-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] leading-5 font-semibold text-rose-700">
                  انتهى حجزُ هذا الكارت وأخذه مستخدمٌ آخر — اسحبْ كارتاً جديداً قبل الحفظ.
                </div>
              )}
              {copyFail && card?.serial && (
                <div className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] leading-5 text-amber-800">
                  تعذّر النسخُ تلقائيّاً على هذا المتصفّح — اضغطْ مطوّلاً على السيريال أعلاه ثمّ «نسخ».
                </div>
              )}
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
              <button className="bs b1" onClick={() => confirm(true)} disabled={saving || mismatchBlock} title={mismatchBlock ? "يوزرُ الساس مختلف — ضع صحَّ الإقرار أوّلاً" : undefined}>💾 حفظ وطباعة</button>
              <button className="bs b2" onClick={() => confirm(false)} disabled={saving || mismatchBlock} title={mismatchBlock ? "يوزرُ الساس مختلف — ضع صحَّ الإقرار أوّلاً" : undefined}>{saving ? "جاري..." : "✅ حفظ و اغلاق"}</button>
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
              ) : embedErr ? (
                /* فشلُ التهيئة يُقال بسببه الحرفيّ — هو نصُّ التشخيص عند تكرار البلاغ */
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
                  <div className="text-3xl">⚠️</div>
                  <div className="text-sm font-bold text-rose-700">تعذّر فتحُ لوحة الساس داخل النافذة</div>
                  <div className="max-w-md rounded-lg bg-rose-50 px-3 py-2 text-xs leading-6 text-rose-800" dir="auto">{embedErr}</div>
                  <div className="flex gap-2">
                    <button onClick={() => setEmbedTry((n) => n + 1)} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-bold text-white hover:bg-mynet-blue-dark">↺ إعادة محاولة</button>
                    {directLink && (
                      <a href={directLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">فتح بنافذة جديدة ↗</a>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">النافذةُ تبقى مفتوحةً والكارتُ محجوزاً — أكمِل التفعيلَ من النافذة الجديدة ثمّ احفظ هنا.</div>
                </div>
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
