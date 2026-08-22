"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type EventTpl = { type: string; text: string; enable: string; officeCustom?: boolean; reset?: boolean;
  // البند ٣ · صورةٌ ترافق الرسالة (data URI). imageOwn=false ⇒ الصورةُ موروثةٌ من قالب
  // الوكيل ولا يملكها المكتب، فلا يُعرَض له زرُّ حذفٍ لِما ليس له.
  // imageDirty: لمسها المستخدمُ في هذه الجلسة ⇒ تُرسَل. وبدونها **لا تُرسَل أبداً** —
  // فحفظٌ يُعيد كتابةَ صورةٍ لم تُلمَس يَنسخ صورةَ الوكيل إلى صفّ المكتب فتنفصل عنه.
  image?: string | null; imageOwn?: boolean; imageDirty?: boolean };

// سقفُ الصورة: ٣٠٠ كيلوبايت ملفّاً أصليّاً. **ولماذا سقفٌ أصلاً؟** الصورةُ تُخزَّن في
// الصفّ base64 (تضخيمُ ٣٣٪) و**تُقرأ في كلّ إرسال** على حاسبة المكتب — فصورةُ ٥ ميغا
// تُثقل كلَّ رسالةٍ لكلّ مشتركٍ إلى الأبد. والخادمُ يحرس السقفَ أيضاً (٤٠٠ ألف حرف).
const IMAGE_MAX_BYTES = 300 * 1024;
type CustomTpl = { id: number; name: string; text: string; dirty?: boolean };
type Office = { id: number; name: string | null };
// 📦 قالبُ باقةٍ واحدة في وضع «حسب الباقة» — نفسُ حقول قالب الحدث + هويّةُ الباقة
type PkgTpl = { packageId: number; name: string; price: number; text: string; enable: string;
  officeCustom?: boolean; image?: string | null; imageOwn?: boolean; dirty?: boolean; imageDirty?: boolean };

// القوالب المربوطة بالأحداث (لا تُحذف ولا يُعاد تسميتها — تُعطَّل بمفتاح «مفعّل»)
const EVENTS: { type: string; name: string; hint: string }[] = [
  { type: "activation", name: "تفعيل الاشتراك", hint: "تُرسل تلقائياً للمشترك عند تفعيل/تجديد الاشتراك" },
  { type: "expiring", name: "تذكير قبل الانتهاء", hint: "تُرسل تلقائياً للمشتركين المنتهين خلال يومين (بوقت التذكير المحدّد)" },
  { type: "debtPaid", name: "تسديد دين", hint: "تُرسل تلقائياً للمشترك عند تسديد دفعة من ديونه" },
  { type: "debts", name: "مطالبة بالديون", hint: "تُرسل من صفحة الديون بزر «رسالة مطالبة للمحدّدين»" },
  { type: "cardRaised", name: "رفعُ بطاقةٍ للمشترك", hint: "تُرسل للمشترك لحظةَ رفعِ بطاقةٍ له — من البرنامج أو من أودو. مرّةً واحدةً لكلّ بطاقة." },
  { type: "maintenance", name: "الصيانة/التنصيب", hint: "تُرسل للمشترك عند إنجاز الفني للصيانة/التنصيب" },
  { type: "reward", name: "منح المكافأة", hint: "تُرسل عند منح مكافأة التفعيل (الكود + الرصيد)" },
  { type: "rewardUsed", name: "استخدام المكافأة", hint: "تُرسل عند خصم/استخدام كود المكافأة" },
  { type: "subSummary", name: "ملخص الاشتراك (وصل)", hint: "تُرسل بزر «💬 ارسال ملخص» في صفحة المشتركين — وصل فوري بحالة اشتراك المشترك" },
  { type: "noAnswer", name: "ميجاوب (لم يرد)", hint: "تُرسل عند ضغط الفني «📵 ميجاوب» على البطاقة — تخبر المشترك أننا اتصلنا ولم يجب، والبطاقة تبقى بمكانها" },
  { type: "loan", name: "قرض فزعة", hint: "تُرسل تلقائياً للمشترك عند منحه قرض فزعة (تمديد 30 يوماً)" },
  // 📋 سجلّ المزامنة (طلب محمد 2026-08-20): قالبا تبويبَي «تفعيل خارجي» و«تنصيب خارجي» —
  // الإرسال تلقائيٌّ أو يدويٌّ حسب جيك بوكس «إرسال رسائل تلقائي» أعلى كلّ تبويب
  { type: "selfActivated", name: "تفعيلات خارجية", hint: "لمن فعّل اشتراكه بنفسه (تبويب «تفعيل خارجي» بسجلّ المزامنة) — تلقائياً إن فُعّل «إرسال رسائل تلقائي» هناك، أو يدوياً بتحديد المشتركين" },
  { type: "externalInstall", name: "تنصيبات خارجية", hint: "لمن نصّبته الشركة (تبويب «تنصيب خارجي» بسجلّ المزامنة) — تلقائياً إن فُعّل «إرسال رسائل تلقائي» هناك، أو يدوياً بتحديد المشتركين" },
  { type: "other", name: "أخرى (عام)", hint: "قالب عام قديم — يظهر ضمن القوالب الجاهزة عند الإرسال اليدوي" },
];
const EVENT_TYPES = EVENTS.map((e) => e.type);

// الحقول التسعة — الضغط يدرج السطر الكامل حرفياً (اسم الحقل : القيمة) بموضع المؤشر
const FIELDS: { label: string; line: string }[] = [
  { label: "نوع الباقة", line: "نوع الباقة : {نوع_الباقة}" },
  { label: "البطاقة", line: "البطاقة : {البطاقة}" },
  { label: "اسم المستخدم", line: "اسم المستخدم : {اسم_المستخدم}" },
  { label: "اسم المشترك", line: "اسم المشترك : {اسم_المشترك}" },
  { label: "مبلغ الاشتراك", line: "مبلغ الاشتراك : *{مبلغ_الاشتراك}*" },
  { label: "المبلغ المستلم", line: "تم استلام مبلغ قدره : *{المبلغ_المستلم}*" },
  { label: "المبلغ المتبقي", line: "والمبلغ المتبقي : *{المبلغ_المتبقي}*" },
  { label: "اجمالي الديون", line: "اجمالي الديون : *{اجمالي_الديون}*" },
  { label: "تاريخ الانتهاء", line: "سينتهي الاشتراك في الساعة الخامسة مساءا بتاريخ : {تاريخ_الانتهاء}" },
  { label: "كود الخصم", line: "كود الخصم : *{كود_الخصم}*" },
  { label: "رصيد كود الخصم", line: "رصيد كود الخصم : *{رصيد_المكافأة}* د.ع" },
  // «ادرس 1» من الساس (طلب محمد 2026-08-09) — يظهر في الرسالة فقط إن أدرجه المدير هنا
  { label: "العنوان (ادرس 1)", line: "العنوان : {العنوان}" },
];

// متغيّرات إضافية خاصة ببعض الأحداث (تُدرج كرمز فقط بموضع المؤشر)
const EXTRA_VARS: Record<string, { token: string; label: string }[]> = {
  activation: [
    { token: "{deliveryLine}", label: "سطر التوصيل (يظهر عند وجوده)" },
    { token: "{delivery}", label: "مبلغ التوصيل" },
    { token: "{total}", label: "الإجمالي (اشتراك+توصيل)" },
    { token: "{office}", label: "اسم المكتب" },
  ],
  expiring: [{ token: "{office}", label: "اسم المكتب" }, { token: "{phone}", label: "هاتف المشترك" }],
  debtPaid: [{ token: "{office}", label: "اسم المكتب" }],
  debts: [{ token: "{office}", label: "اسم المكتب" }, { token: "{phone}", label: "هاتف المشترك" }],
  // البند ٧ · رُفعت بطاقةٌ للمشترك (من البرنامج أو أودو) — طلبُ محمد 2026-08-13
  cardRaised: [
    { token: "{الاسم}", label: "اسم المشترك" },
    { token: "{اليوزر}", label: "اسم المستخدم" },
    { token: "{العملية}", label: "نوع العملية (صيانة/توصيل/…)" },
    { token: "{التفاصيل}", label: "عنوان البطاقة" },
    { token: "{المكتب}", label: "اسم المكتب" },
    { token: "{المصدر}", label: "المصدر (أودو / المكتب)" },
  ],
  maintenance: [
    { token: "{kind}", label: "نوع العمل" },
    { token: "{details}", label: "تفاصيل الصيانة" },
    { token: "{technician}", label: "اسم الفني" },
    { token: "{date}", label: "تاريخ العملية" },
    { token: "{amount}", label: "المبلغ الكلي (مبيع+اشتراك)" },
    { token: "{المبيع}", label: "مبلغ المبيع" },
    { token: "{الاشتراك}", label: "مبلغ الاشتراك" },
    { token: "{office}", label: "اسم المكتب" },
  ],
  reward: [
    { token: "{code}", label: "كود المكافأة" },
    { token: "{balance}", label: "رصيد المكافأة" },
    { token: "{granted}", label: "المبلغ الممنوح" },
  ],
  rewardUsed: [
    { token: "{amount}", label: "المبلغ المخصوم" },
    { token: "{balance}", label: "الرصيد المتبقّي" },
  ],
  subSummary: [
    { token: "{office}", label: "اسم المكتب" },
    { token: "{phone}", label: "هاتف المشترك" },
    { token: "{كود_الخصم}", label: "كود الخصم" },
    { token: "{رصيد_المكافأة}", label: "رصيد المكافأة" },
  ],
  noAnswer: [
    { token: "{kind}", label: "نوع البطاقة" },
    { token: "{technician}", label: "اسم الفني" },
    { token: "{office}", label: "اسم المكتب" },
  ],
  loan: [
    { token: "{الاسم}", label: "اسم المشترك" },
    { token: "{اليوزر}", label: "اسم المستخدم" },
    { token: "{المبلغ}", label: "مبلغ القرض" },
    { token: "{تاريخ_الانتهاء}", label: "تاريخ الانتهاء (الوهمي +30)" },
    { token: "{المكتب}", label: "اسم المكتب" },
  ],
};

// بيانات المعاينة التجريبية (مثال المواصفة) — بالاسمين العربي والإنكليزي
const SAMPLE: Record<string, string> = {
  "نوع_الباقة": "Hero 100Mbps", "البطاقة": "20", "اسم_المستخدم": "bg-5-7-11@mu",
  "اسم_المشترك": "سرمد صبحي فرحان مجاني", "مبلغ_الاشتراك": "45000", "المبلغ_المستلم": "45000",
  "المبلغ_المتبقي": "0", "اجمالي_الديون": "0", "تاريخ_الانتهاء": "12/02/2026 17:00",
  "كود_الخصم": "K7M2QP9A", "رصيد_المكافأة": "30000", "العنوان": "902 ع 3 ش9",
  package: "Hero 100Mbps", card: "20", netUser: "bg-5-7-11@mu", name: "سرمد صبحي فرحان مجاني",
  price: "45000", paid: "45000", remaining: "0", carry: "0", dateTo: "12/02/2026 17:00",
  office: "SHAKEEB", phone: "07701234567", deliveryLine: "التوصيل: 1000 د.ع", delivery: "1000", total: "46000",
  kind: "صيانة", details: "تبديل مقوّي", technician: "علي", date: "12/07/2026",
  code: "K7M2QP9A", balance: "30000", granted: "15000", amount: "10000",
  "الاسم": "سرمد صبحي فرحان مجاني", "اليوزر": "bg-5-7-11@mu", "المبلغ": "45000", "المكتب": "SHAKEEB",
};

// استبدال متغيّرات المعاينة (نفس نمط الخادم: إنكليزي + عربي)
// اسم المكتب الحقيقي يُمرَّر ليحل محل القيمة التجريبية — فتطابق المعاينة ما يصل فعلاً
function renderSample(text: string, officeName?: string | null): string {
  return text.replace(/\{([\w؀-ۿ]+)\}/g, (_, key) => (key === "office" && officeName ? officeName : SAMPLE[key] ?? ""));
}

// عرض النص بين نجمتين *هكذا* بخط عريض (تنسيق واتساب)
function BoldText({ text }: { text: string }) {
  const parts = text.split(/\*([^*\n]+)\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i} className="font-extrabold">{p}</b> : <span key={i}>{p}</span>))}</>;
}

export default function SmsTemplatesPage() {
  const { can, me } = usePermission();
  const [events, setEvents] = useState<Record<string, EventTpl>>({});
  const [customs, setCustoms] = useState<CustomTpl[]>([]);
  const [sel, setSel] = useState<string>("event:activation"); // "event:<type>" | "custom:<id>"
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // عزل القوالب لكل مكتب: "" = قوالب الوكيل العامة، وإلا معرّف المكتب (قالبه يغلب العام)
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSel, setOfficeSel] = useState<string>("");
  // ═════ 📦 «تذكير قبل الانتهاء حسب الباقة» (طلبُ محمد 2026-08-21) ═════
  // قائمةُ الباقات تأتي من الخادم لحظةَ الفتح — فالباقةُ الجديدةُ تظهر من نفسها.
  const [pkgMode, setPkgMode] = useState(false); // مفتاحُ الوضع (يُطفئ القالبَ القديم)
  const [pkgs, setPkgs] = useState<PkgTpl[]>([]);
  const [selPkg, setSelPkg] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // 📦 مربّعُ نصّ الباقة له مرجعُه ودالّةُ إدراجه (طلبُ محمد 2026-08-22): كان مربّعاً عارياً
  //    بلا أزرارِ حقول، فلا يستطيع إدراجَ اسم المشترك ولا تاريخ الانتهاء كبقيّة القوالب.
  const pkgTaRef = useRef<HTMLTextAreaElement | null>(null);
  function insertIntoPkg(text: string, snippet: string, fullLine: boolean, apply: (t: string) => void) {
    const ta = pkgTaRef.current;
    const pos = ta ? ta.selectionStart : text.length;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const nl = String.fromCharCode(10);
    const ins = (fullLine && before.length > 0 && !before.endsWith(nl) ? nl : "") + snippet;
    apply(before + ins + after);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const q = pos + ins.length;
      ta.setSelectionRange(q, q);
    });
  }

  // قوالب الأحداث تُعاد قراءتها عند تبديل المكتب (قالب المكتب إن وُجد وإلا العام)
  useEffect(() => {
    const qs = officeSel ? `?officeId=${officeSel}` : "";
    fetch(`/api/sms-templates/bulk${qs}`).then((r) => void (r.ok && r.json().then((d: { templates: EventTpl[]; officeId: number | null }) => {
      const m: Record<string, EventTpl> = {};
      for (const t of d.templates ?? []) m[t.type] = t;
      setEvents(m);
      setSaved(false);
      // موظف المكتب يُقيَّد بمكتبه من الخادم — نثبّت المبدّل على مكتبه الفعلي
      if (d.officeId != null && String(d.officeId) !== officeSel) setOfficeSel(String(d.officeId));
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeSel]);

  // 📦 قوالبُ الباقات — تُعاد قراءتها مع تبديل المكتب كقوالب الأحداث تماماً
  useEffect(() => {
    const qs = officeSel ? `?officeId=${officeSel}` : "";
    fetch(`/api/sms-templates/by-package${qs}`).then((r) => void (r.ok && r.json().then((d: { master: boolean; packages: PkgTpl[] }) => {
      setPkgMode(!!d.master);
      setPkgs(d.packages ?? []);
      setSelPkg((cur) => cur ?? (d.packages?.[0]?.packageId ?? null));
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeSel]);

  useEffect(() => {
    fetch("/api/sms-templates").then((r) => void (r.ok && r.json().then((rows: { id: number; type: string | null; text: string | null }[]) => {
      setCustoms(rows.filter((r2) => r2.type && !EVENT_TYPES.includes(r2.type)).map((r2) => ({ id: r2.id, name: r2.type ?? "", text: r2.text ?? "" })));
    })));
    fetch("/api/towers").then((r) => void (r.ok && r.json().then((rows: Office[]) => setOffices(rows))));
  }, []);

  const isEvent = sel.startsWith("event:");
  const selType = isEvent ? sel.slice(6) : "";
  const selId = isEvent ? -1 : Number(sel.slice(7));
  const curEvent = isEvent ? (events[selType] ?? { type: selType, text: "", enable: "1" }) : null;
  const curCustom = !isEvent ? customs.find((c) => c.id === selId) : null;
  const curText = isEvent ? (curEvent?.text ?? "") : (curCustom?.text ?? "");
  const curName = isEvent ? (EVENTS.find((e) => e.type === selType)?.name ?? selType) : (curCustom?.name ?? "");
  const curHint = isEvent ? (EVENTS.find((e) => e.type === selType)?.hint ?? "") : "قالب حر — يظهر في «القوالب الجاهزة» عند إرسال رسالة يدوية من صفحة الرسائل";

  const setText = (text: string) => {
    setSaved(false);
    // التعديل تحت مكتب يجعله تخصيصاً لذلك المكتب (ويلغي أي «استخدام القالب العام» معلّق)
    if (isEvent) setEvents((m) => ({ ...m, [selType]: { ...(m[selType] ?? { type: selType, enable: "1" }), type: selType, text, enable: m[selType]?.enable ?? "1", reset: false, ...(officeSel ? { officeCustom: true } : {}) } }));
    else setCustoms((cs) => cs.map((c) => (c.id === selId ? { ...c, text, dirty: true } : c)));
  };
  // 🖼️ تعيينُ/حذفُ صورة القالب — كالنصّ: التعديلُ تحت مكتبٍ يجعله تخصيصاً لذلك المكتب
  const setImage = (image: string | null) => {
    if (!isEvent) return;
    setSaved(false);
    setEvents((m) => ({ ...m, [selType]: { ...(m[selType] ?? { type: selType, text: "", enable: "1" }), type: selType,
      text: m[selType]?.text ?? "", enable: m[selType]?.enable ?? "1", image, imageOwn: image != null, imageDirty: true,
      reset: false, ...(officeSel ? { officeCustom: true } : {}) } }));
  };

  async function pickImage(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("الملفّ ليس صورة"); return; }
    if (file.size > IMAGE_MAX_BYTES) {
      setErr(`الصورة ${Math.round(file.size / 1024)} كيلوبايت — والحدُّ ${IMAGE_MAX_BYTES / 1024} كيلوبايت. اختر صورةً أصغر أو اضغطها.`);
      return;
    }
    setErr("");
    const dataUri = await new Promise<string | null>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => res(null);
      fr.readAsDataURL(file);
    });
    if (!dataUri) { setErr("تعذّر قراءة الصورة"); return; }
    setImage(dataUri);
  }

  const setEnable = (on: boolean) => {
    if (!isEvent) return;
    setSaved(false);
    // تبديل التفعيل تحت مكتب يجعله تخصيصاً لذلك المكتب أيضاً
    setEvents((m) => ({ ...m, [selType]: { ...(m[selType] ?? { type: selType, text: "" }), type: selType, text: m[selType]?.text ?? "", enable: on ? "1" : "0", reset: false, ...(officeSel ? { officeCustom: true } : {}) } }));
  };

  // إدراج سطر حقل كامل (أو رمز متغيّر) بموضع المؤشر — بسطر جديد إن لم يكن المؤشر بداية سطر
  function insertAtCursor(snippet: string, fullLine: boolean) {
    const ta = taRef.current;
    const pos = ta ? ta.selectionStart : curText.length;
    const before = curText.slice(0, pos);
    const after = curText.slice(pos);
    const needsNewline = fullLine && before.length > 0 && !before.endsWith("\n");
    const ins = (needsNewline ? "\n" : "") + snippet;
    setText(before + ins + after);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const p = pos + ins.length;
      ta.setSelectionRange(p, p);
    });
  }

  async function addTemplate() {
    const name = prompt("اسم القالب الجديد:")?.trim();
    if (!name) return;
    if (EVENT_TYPES.includes(name) || customs.some((c) => c.name === name) || EVENTS.some((e) => e.name === name)) {
      alert("يوجد قالب بهذا الاسم"); return;
    }
    const r = await fetch("/api/sms-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: name, text: "", enable: "1" }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) { alert(d?.error ?? "تعذّرت الإضافة"); return; }
    setCustoms((cs) => [...cs, { id: d.id, name, text: "" }]);
    setSel(`custom:${d.id}`);
  }

  async function renameTemplate(c: CustomTpl) {
    const name = prompt("الاسم الجديد للقالب:", c.name)?.trim();
    if (!name || name === c.name) return;
    if (EVENT_TYPES.includes(name) || customs.some((x) => x.name === name) || EVENTS.some((e) => e.name === name)) {
      alert("يوجد قالب بهذا الاسم"); return;
    }
    const r = await fetch(`/api/sms-templates/${c.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: name, text: c.text }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d?.error ?? "تعذّرت إعادة التسمية"); return; }
    setCustoms((cs) => cs.map((x) => (x.id === c.id ? { ...x, name } : x)));
  }

  async function deleteTemplate(c: CustomTpl) {
    if (EVENTS.length + customs.length <= 1) { alert("لا يُسمح بحذف آخر قالب"); return; }
    if (!confirm(`حذف قالب «${c.name}» نهائياً؟`)) return;
    const r = await fetch(`/api/sms-templates/${c.id}`, { method: "DELETE" });
    if (!r.ok) { alert("تعذّر الحذف"); return; }
    setCustoms((cs) => cs.filter((x) => x.id !== c.id));
    if (sel === `custom:${c.id}`) setSel("event:activation");
  }

  // إزالة تخصيص المكتب لقالب: يعود لقالب الوكيل العام (تُحفظ عند «حفظ القوالب»)
  function resetToAgent(type: string) {
    setSaved(false);
    setEvents((m) => ({ ...m, [type]: { ...(m[type] ?? { type, text: "", enable: "1" }), type, reset: true, officeCustom: false } }));
  }

  async function save() {
    setSaving(true); setSaved(false); setErr("");
    // 📦 وضعُ «حسب الباقة»: مسارُه المستقلّ — يحفظ المفتاحَ وقوالبَ الباقات الملموسةَ وحدَها
    if (sel === "bypkg") {
      const r = await fetch("/api/sms-templates/by-package", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officeId: officeSel ? Number(officeSel) : null,
          master: pkgMode,
          packages: pkgs.filter((k) => k.dirty).map((k) => ({
            packageId: k.packageId, text: k.text ?? "", enable: k.enable ?? "1",
            ...(k.imageDirty ? { image: k.image ?? null } : {}),
          })),
        }),
      });
      setSaving(false);
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error ?? "تعذّر الحفظ"); return; }
      setSaved(true);
      setPkgs((list) => list.map((k) => ({ ...k, dirty: false, imageDirty: false })));
      // 🔒 القفلُ المتبادل يُطبَّق على الخادم — نُعيد قراءةَ القوالب ليظهر أثرُه فوراً
      const qs = officeSel ? `?officeId=${officeSel}` : "";
      fetch(`/api/sms-templates/bulk${qs}`).then((r2) => void (r2.ok && r2.json().then((d: { templates: EventTpl[] }) => {
        const m: Record<string, EventTpl> = {};
        for (const t of d.templates ?? []) m[t.type] = t;
        setEvents(m);
      })));
      return;
    }
    // قوالب الأحداث دفعة واحدة (مع المكتب المختار إن وُجد — قالب المكتب يغلب العام).
    // تحت مكتب: تُرسل المخصّصة/المُلغاة فقط — غير المخصّصة تبقى تابعة للقالب العام
    const templates = EVENTS
      .map((e) => {
        const t = events[e.type] ?? { type: e.type, text: "", enable: "1" };
        // 🖼️ الصورةُ تُرسَل **فقط إن كان القالبُ يملكها** — فصورةٌ موروثةٌ من الوكيل لو
        //   أُرسلت لَنُسِخت إلى صفّ المكتب، فانفصلت عن الوكيل وما تبِعت تحديثَه بعدُ أبداً.
        return { type: e.type, text: t.text ?? "", enable: t.enable ?? "1", officeCustom: !!t.officeCustom,
          ...(t.imageDirty ? { image: t.image ?? null } : {}), // لم تُلمَس ⇒ حقلٌ غائبٌ ⇒ الخادمُ لا يمسّها
          ...(t.reset ? { reset: true } : {}) };
      })
      .filter((t) => !officeSel || t.officeCustom || t.reset)
      .map(({ officeCustom: _oc, ...t }) => t);
    const r1 = await fetch("/api/sms-templates/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates, officeId: officeSel ? Number(officeSel) : null }),
    });
    // القوالب الحرة المعدَّلة
    let ok = r1.ok;
    for (const c of customs.filter((x) => x.dirty)) {
      const r2 = await fetch(`/api/sms-templates/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: c.name, text: c.text }),
      });
      ok = ok && r2.ok;
    }
    setSaving(false);
    if (ok) {
      setSaved(true); setCustoms((cs) => cs.map((c) => ({ ...c, dirty: false })));
      // 🔒 أثرُ القفل المتبادل: تفعيلُ «تذكير قبل الانتهاء» يُطفئ وضعَ الباقات على الخادم
      if ((events["expiring"]?.enable ?? "1") !== "0" && pkgMode) setPkgMode(false);
      // إعادة القراءة: تعكس حالة التخصيص الفعلية (خاصة بعد «استخدام قالب الوكيل»)
      const qs = officeSel ? `?officeId=${officeSel}` : "";
      const d = await fetch(`/api/sms-templates/bulk${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (d?.templates) {
        const m: Record<string, EventTpl> = {};
        for (const t of d.templates as EventTpl[]) m[t.type] = t;
        setEvents(m);
      }
    }
    else setErr("تعذّر حفظ بعض القوالب — أعد المحاولة");
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("templates.manage")) {
    return <div className="p-6"><PageHeader title="قوالب الرسائل" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إدارة قوالب الرسائل.</div></div>;
  }

  // اسم المكتب الحقيقي للمعاينة: المكتب المختار بالمبدّل، وإلا أول مكاتب الوكيل، وإلا اسم الوكيل
  const previewOffice = (officeSel ? offices.find((o) => String(o.id) === officeSel)?.name : null)
    ?? offices[0]?.name ?? me?.agentName ?? null;
  const preview = renderSample(curText, previewOffice);

  return (
    <div className="p-6" dir="rtl">
      <PageHeader title="قوالب الرسائل" subtitle="قوالب بتنسيق واتساب (*النص العريض*) بمتغيّرات تُستبدل ببيانات كل مشترك عند الإرسال" />

      {/* مبدّل المكتب: قوالب الأحداث معزولة لكل مكتب — قالب المكتب يغلب قالب الوكيل العام */}
      <div data-app-bar className="mb-4 flex max-w-7xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-sm font-semibold text-slate-600">🏢 قوالب:</span>
        <select value={officeSel} onChange={(e) => setOfficeSel(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-mynet-blue">
          <option value="">عامة لكل المكاتب (الوكيل)</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `مكتب ${o.id}`}</option>)}
        </select>
        <span className="text-xs text-slate-400">
          {officeSel
            ? "تعديلاتك هنا تخص هذا المكتب فقط وتغلب القالب العام — والقوالب غير المخصّصة تتبع العام تلقائياً"
            : "القالب العام يسري على كل مكتب ليس له قالب مخصّص"}
        </span>
      </div>

      <div className="grid max-w-7xl gap-5 lg:grid-cols-[260px_1fr_1fr]">
        {/* قائمة القوالب */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <button onClick={addTemplate} className="mb-3 w-full rounded-lg bg-mynet-blue py-2 text-sm font-bold text-white hover:bg-mynet-blue-dark">＋ إضافة قالب جديد</button>

          <div className="mb-1 text-[11px] font-bold text-slate-400">قوالب تلقائية (مربوطة بأحداث)</div>
          <div className="mb-3 space-y-1">
            {EVENTS.map((e) => {
              const on = (events[e.type]?.enable ?? "1") !== "0";
              const active = sel === `event:${e.type}`;
              return (
                <button key={e.type} onClick={() => setSel(`event:${e.type}`)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm font-semibold transition ${active ? "bg-mynet-blue text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>
                  <span className="truncate">{e.name}</span>
                  <span className={`mr-1 h-2 w-2 shrink-0 rounded-full ${on ? "bg-emerald-400" : "bg-slate-300"}`} title={on ? "مفعّل" : "معطَّل"} />
                </button>
              );
            })}
          </div>

          {/* 📦 صنفٌ مستقلٌّ: قالبٌ لكلّ باقة — وتفعيلُه يُطفئ «تذكير قبل الانتهاء» العامّ */}
          <div className="mb-1 text-[11px] font-bold text-slate-400">حسب الباقة</div>
          <div className="mb-3">
            <button onClick={() => setSel("bypkg")}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm font-semibold transition ${sel === "bypkg" ? "bg-mynet-blue text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>
              <span className="truncate">📦 تذكير قبل الانتهاء حسب الباقة</span>
              <span className={`mr-1 h-2 w-2 shrink-0 rounded-full ${pkgMode ? "bg-emerald-400" : "bg-slate-300"}`} title={pkgMode ? "مفعّل" : "معطَّل"} />
            </button>
          </div>

          <div className="mb-1 text-[11px] font-bold text-slate-400">قوالبي (للإرسال اليدوي)</div>
          <div className="space-y-1">
            {customs.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-center text-[11px] text-slate-400">لا قوالب مضافة — أضِف قالبك الأول</div>}
            {customs.map((c) => {
              const active = sel === `custom:${c.id}`;
              return (
                <div key={c.id} className={`flex items-center gap-1 rounded-lg px-1 py-1 ${active ? "bg-mynet-blue" : "bg-slate-50 hover:bg-slate-100"}`}>
                  <button onClick={() => setSel(`custom:${c.id}`)} className={`min-w-0 flex-1 truncate px-2 py-1 text-right text-sm font-semibold ${active ? "text-white" : "text-slate-700"}`}>
                    {c.name}{c.dirty ? " •" : ""}
                  </button>
                  <button onClick={() => renameTemplate(c)} title="إعادة تسمية" className={`rounded p-1 text-xs ${active ? "text-white/80 hover:bg-white/20" : "text-slate-400 hover:bg-slate-200"}`}>✏️</button>
                  <button onClick={() => deleteTemplate(c)} title="حذف" className={`rounded p-1 text-xs ${active ? "text-white/80 hover:bg-white/20" : "text-slate-400 hover:bg-slate-200"}`}>🗑</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═════ 📦 لوحةُ «تذكير قبل الانتهاء حسب الباقة» ═════ */}
        {sel === "bypkg" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-1 text-base font-bold text-slate-800">📦 تذكير قبل الانتهاء حسب الباقة</div>
            <div className="mb-3 text-xs leading-relaxed text-slate-500">
              لكلّ باقةٍ نصُّها الخاصّ، ويُرسَل للمشترك قبل انتهائه **حسب باقته** بالتعرّف الآليّ.
              <b className="text-slate-700"> ومن لا باقةَ له لا يصله تذكيرُ انتهاءٍ إطلاقاً</b> (وبقيّةُ رسائله تصل طبيعيّاً).
              وباقةٌ تُترَك فارغةً لا تُرسَل لأصحابها.
            </div>
            <label className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${pkgMode ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
              <input type="checkbox" className="h-4 w-4" checked={pkgMode}
                onChange={(e) => {
                  const on = e.target.checked;
                  setPkgMode(on); setSaved(false);
                  // 🔁 **القفلُ المتبادلُ يُرى لحظتَه** (طلبُ محمد): دائرةُ «تذكير قبل الانتهاء»
                  //    تنطفئ فورَ التفعيل وتُضيء فورَ الإلغاء — بلا انتظار حفظٍ ولا إعادةِ قراءة.
                  //    (والخادمُ يُثبّت الحالةَ نفسَها عند الحفظ، فلا يفترقان.)
                  setEvents((m) => ({
                    ...m,
                    expiring: { ...(m.expiring ?? { type: "expiring", text: "" }), type: "expiring", enable: on ? "0" : "1" },
                  }));
                }} />
              تفعيل الوضع «حسب الباقة»
              <span className="mr-auto text-[11px] font-semibold text-slate-400">تفعيلُه يُطفئ «تذكير قبل الانتهاء» العامّ تلقائيّاً — ولا يعملان معاً أبداً</span>
            </label>
            {pkgs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">لا باقات في حسابك بعد — أضِف باقةً من صفحة الباقات ويظهر لها قالبٌ هنا تلقائيّاً</div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {pkgs.map((k) => (
                    <button key={k.packageId} onClick={() => setSelPkg(k.packageId)}
                      className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${selPkg === k.packageId ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {k.name}{k.text?.trim() ? "" : " •"}
                    </button>
                  ))}
                </div>
                {(() => {
                  const cur = pkgs.find((k) => k.packageId === selPkg) ?? null;
                  if (!cur) return null;
                  const upd = (patch: Partial<PkgTpl>) => {
                    setSaved(false);
                    setPkgs((list) => list.map((k) => (k.packageId === cur.packageId ? { ...k, ...patch, dirty: true } : k)));
                  };
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold text-slate-700">{cur.name}{cur.price ? ` — ${cur.price.toLocaleString("en-US")} د.ع` : ""}</div>
                        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                          <input type="checkbox" className="h-4 w-4" checked={cur.enable !== "0"} onChange={(e) => upd({ enable: e.target.checked ? "1" : "0" })} />
                          مفعّل
                        </label>
                      </div>
                      {/* أزرارُ الحقول والمتغيّرات — نفسُها في قوالب الأحداث، وتُدرج بموضع المؤشّر */}
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-500">أدرج حقلاً (يُدرج السطر كاملاً «اسم الحقل : القيمة»):</div>
                        <div className="flex flex-wrap gap-1.5">
                          {FIELDS.map((f) => (
                            <button key={f.label} type="button"
                              onClick={() => insertIntoPkg(cur.text ?? "", f.line, true, (t) => upd({ text: t }))}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                              {f.label}
                            </button>
                          ))}
                        </div>
                        <div className="mb-1 mt-2 text-xs font-semibold text-slate-500">متغيّرات إضافية (تُدرج كرمز):</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(EXTRA_VARS.expiring ?? []).map((v) => (
                            <button key={v.token} type="button"
                              onClick={() => insertIntoPkg(cur.text ?? "", v.token, false, (t) => upd({ text: t }))}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                              {v.label} <code className="text-[10px] text-slate-400" dir="ltr">{v.token}</code>
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        ref={pkgTaRef}
                        value={cur.text}
                        onChange={(e) => upd({ text: e.target.value })}
                        rows={8}
                        placeholder="اكتب نصَّ التذكير لهذه الباقة… (يقبل نفس الحقول: {اسم_المشترك} · {تاريخ_الانتهاء} · {مبلغ_الاشتراك} …)"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-mynet-blue"
                        dir="rtl"
                      />
                      <div className="rounded-xl bg-[#e5ddd5] p-4">
                        <div className="mr-auto max-w-full whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 text-sm leading-relaxed text-slate-800 shadow-sm" dir="rtl">
                          {cur.image && (
                            // eslint-disable-next-line @next/next/no-img-element -- data URI محليّة
                            <img src={cur.image} alt="صورة القالب" className="mb-1.5 max-h-56 w-full rounded-md object-contain" />
                          )}
                          {cur.text ? <BoldText text={renderSample(cur.text, (officeSel ? offices.find((o) => String(o.id) === officeSel)?.name : null) ?? me?.agentName ?? null)} /> : <span className="text-slate-400">لا نصَّ لهذه الباقة — لن تُرسَل رسالةٌ لأصحابها</span>}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* 🔴 **زرُّ الحفظ كان غائباً عن هذه اللوحة** (بلاغُ محمد 2026-08-22): كان مكتوباً
                داخل محرّر القوالب العاديّة وحدَه، فمن يكتب نصَّ باقةٍ لا يجد ما يحفظ به.
                وهو نفسُ الزرّ ونفسُ الدالّة — لا مسارَ ثانٍ ولا سلوكَ مختلف. */}
            {err && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
            {saved && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ تم حفظ القوالب</div>}
            <button onClick={save} disabled={saving}
              className="mt-4 w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
              {saving ? "جاري الحفظ..." : "حفظ قوالب الباقات"}
            </button>
          </div>
        ) : (
        <>
        {/* المحرّر */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-base font-bold text-slate-800">
                {curName}
                {/* حالة التخصيص لهذا المكتب: مخصّص له أو يتبع قالب الوكيل العام */}
                {isEvent && officeSel && (curEvent?.officeCustom
                  ? <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">مخصّص لهذا المكتب</span>
                  : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">يتبع القالب العام</span>)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{curHint}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* إزالة تخصيص المكتب — يعود القالب لقالب الوكيل العام */}
              {isEvent && officeSel && curEvent?.officeCustom && (
                <button onClick={() => resetToAgent(selType)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">
                  استخدام القالب العام
                </button>
              )}
              {isEvent && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={(curEvent?.enable ?? "1") !== "0"} onChange={(e) => setEnable(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                  مفعّل
                </label>
              )}
            </div>
          </div>

          <textarea
            ref={taRef}
            value={curText}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            dir="rtl"
            placeholder="اكتب نص الرسالة بحرية، وأدرج الحقول من الأزرار أدناه بموضع المؤشر..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-mynet-blue"
          />

          {/* 🖼️ البند ٣ · صورةٌ ترافق الرسالة — تُرسَل **مع النصّ تعليقاً واحداً** لا رسالتَين */}
          {isEvent && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-600">
                  صورة مع الرسالة{" "}
                  <span className="font-normal text-slate-400">(اختيارية — تُرسل مع النصّ برسالةٍ واحدة)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="cursor-pointer rounded-lg bg-mynet-blue px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90">
                    {curEvent?.image ? "تغيير الصورة" : "إضافة صورة"}
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                  {curEvent?.image && curEvent?.imageOwn && (
                    <button onClick={() => setImage(null)} className="rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-100">
                      حذف الصورة
                    </button>
                  )}
                </div>
              </div>
              {curEvent?.image ? (
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={curEvent.image} alt="صورة القالب" className="max-h-32 rounded-lg border border-slate-200 bg-white object-contain" />
                  <div className="text-[11px] leading-relaxed text-slate-500">
                    ≈ {Math.round((curEvent.image.length * 3) / 4 / 1024)} كيلوبايت
                    {officeSel && !curEvent.imageOwn && (
                      <span className="mt-1 block rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">
                        موروثة من القالب العام — لتخصيص صورةٍ لهذا المكتب اضغط «تغيير الصورة»
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">
                  لا صورة. الحدُّ الأعلى {IMAGE_MAX_BYTES / 1024} كيلوبايت — والصورةُ الكبيرة تُبطئ كلَّ رسالةٍ تُرسَل بهذا القالب.
                </div>
              )}
            </div>
          )}

          {/* الحقول التسعة: إدراج السطر الكامل بموضع المؤشر */}
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-slate-500">أدرج حقلاً (يُدرج السطر كاملاً «اسم الحقل : القيمة»):</div>
            <div className="flex flex-wrap gap-1.5">
              {/* ⚠️ قالبا سجلّ المزامنة بلا تاريخ انتهاءٍ أبداً (قرار محمد 2026-08-21):
                  التاريخُ لحظةَ الرصد خاطئٌ حتماً (عرضُ ١٠ أيّامٍ قبل الأيّام الحقيقيّة)
                  — فزرُّ إدراجه يُخفى، والمُرسِلُ يمحو أيَّ سطرِ تاريخٍ كُتب يدويّاً */}
              {FIELDS.filter((f) => !(["selfActivated", "externalInstall"].includes(selType) && f.line.includes("{تاريخ_الانتهاء}"))).map((f) => (
                <button key={f.label} type="button" onClick={() => insertAtCursor(f.line, true)}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* متغيّرات إضافية خاصة بالحدث */}
          {isEvent && (EXTRA_VARS[selType]?.length ?? 0) > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold text-slate-500">متغيّرات إضافية لهذا القالب (تُدرج كرمز):</div>
              <div className="flex flex-wrap gap-1.5">
                {EXTRA_VARS[selType].map((v) => (
                  <button key={v.token} type="button" onClick={() => insertAtCursor(v.token, false)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                    {v.label} <code className="text-[10px] text-slate-400" dir="ltr">{v.token}</code>
                  </button>
                ))}
              </div>
            </div>
          )}

          {saved && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ تم حفظ القوالب</div>}
          {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
          <button onClick={save} disabled={saving} className="mt-4 w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
            {saving ? "جاري الحفظ..." : "حفظ القوالب"}
          </button>
        </div>

        {/* المعاينة — بنمط فقاعة واتساب مع خط عريض بين النجوم */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">معاينة الرسالة (بيانات تجريبية)</div>
          <div className="rounded-xl bg-[#e5ddd5] p-4">
            <div className="mr-auto max-w-full whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 text-sm leading-relaxed text-slate-800 shadow-sm" dir="rtl">
              {/* ═════ 🖼️ الصورةُ **داخل الفقاعة** فوق النصّ (بلاغُ محمد 2026-08-21) ═════
                  «أعتقد أنّ الصورة لا تصل لأنّها غير مربوطةٍ مع الرسالة أصلاً — لا تظهر في
                   المعاينة». وكانت المعاينةُ تعرض النصَّ وحدَه فعلاً، والصورةُ في مربّعٍ
                   منفصلٍ بجانب زرّ الرفع — فلا شيءَ يقول إنّها ستُرسَل معه. وواتسابُ
                   يعرضها هكذا بالضبط: صورةٌ يعلوها النصُّ تعليقاً في **رسالةٍ واحدة**. */}
              {curEvent?.image && (
                // eslint-disable-next-line @next/next/no-img-element -- صورةُ القالب data URI محليّةٌ لا تمرّ بمُحسِّن الصور
                <img src={curEvent.image} alt="صورة القالب" className="mb-1.5 max-h-56 w-full rounded-md object-contain" />
              )}
              {curText ? <BoldText text={preview} /> : <span className="text-slate-400">لا يوجد نص بعد — اكتب في المحرّر أو أدرج الحقول</span>}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            القيم أعلاه تجريبية للتوضيح، وتُستبدل ببيانات كل مشترك الحقيقية عند الإرسال. النص بين نجمتين *هكذا* يصل بخط عريض في واتساب.
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
