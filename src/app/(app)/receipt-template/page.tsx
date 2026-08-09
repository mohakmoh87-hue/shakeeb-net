"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";
import {
  resolveDims, resolveFields, resolveOrder, DEFAULT_ORDER,
  RECEIPT_FIELDS, RECEIPT_TOGGLES, PAPER_LIMITS,
  NOTICE_FIELDS, NOTICE_DEFAULT_ORDER, resolveNoticeFields, resolveNoticeOrder,
} from "@/lib/receiptPaper";

type Tpl = {
  headerText: string;
  footerText: string;
  addressText: string; // عنوان المكتب — سطرٌ أسفل التذييل
  logo: string;
  fontColor: string;
  bgColor: string;
  headerColor: string;
  fontSize: number;
  showLogo: boolean;
  paperW: number;
  paperH: number;
  contentW: number;
  fields: Record<string, boolean>;
  fieldOrder: string[];
  printerName: string;
};

const DEFAULT: Tpl = {
  headerText: "", footerText: "شكراً لاشتراككم", addressText: "", logo: "",
  fontColor: "#1e293b", bgColor: "#ffffff", headerColor: "#1e66c9",
  fontSize: 14, showLogo: true,
  paperW: 80, paperH: 0, contentW: 68,
  fields: resolveFields(null), fieldOrder: [...DEFAULT_ORDER],
  printerName: "",
};

const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  [...RECEIPT_FIELDS, ...NOTICE_FIELDS].map((f) => [f.key, f.label]),
);

type Office = { id: number; name: string | null };

export default function ReceiptTemplatePage() {
  const { can, me } = usePermission();
  const [t, setT] = useState<Tpl>(DEFAULT);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  // عزل قالب الوصل لكل مكتب: "" = قالب الوكيل العام، وإلا معرّف المكتب (قالبه يغلب العام)
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSel, setOfficeSel] = useState<string>("");
  const [officeCustom, setOfficeCustom] = useState(false);
  // طابعات حاسبة المكتب (يبلّغ بها العامل) — للاختيار من قائمة بدل كتابة الاسم يدويّاً
  const [printers, setPrinters] = useState<string[]>([]);
  // نوع القالب: وصل الاشتراك، أو «وصل المشترك» لطباعة وصولات صفحة كلّ المشتركين (طلب محمد 2026-08-09)
  const [kind, setKind] = useState<"receipt" | "notice">("receipt");
  const isNotice = kind === "notice";

  const load = (office: string, k: "receipt" | "notice" = kind) => {
    const qs = `?kind=${k}${office ? `&officeId=${office}` : ""}`;
    fetch(`/api/receipt-template${qs}`).then((r) => void (r.ok && r.json().then((d) => {
      const nf = k === "notice";
      setT({
        ...DEFAULT, ...d,
        fields: nf ? resolveNoticeFields(d.fields) : resolveFields(d.fields),
        fieldOrder: nf ? resolveNoticeOrder(d.fieldOrder) : resolveOrder(d.fieldOrder),
      });
      setOfficeCustom(!!d.officeCustom);
      setPrinters(Array.isArray(d.availablePrinters) ? d.availablePrinters : []);
      setSaved(false);
      if (d.officeId != null && String(d.officeId) !== office) setOfficeSel(String(d.officeId));
    })));
  };
  useEffect(() => { load(officeSel, kind); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [officeSel, kind]);
  useEffect(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then((rows: Office[]) => setOffices(rows))));
  }, []);

  const set = <K extends keyof Tpl>(k: K, v: Tpl[K]) => setT((s) => ({ ...s, [k]: v }));
  const setField = (key: string, v: boolean) => setT((s) => ({ ...s, fields: { ...s.fields, [key]: v } }));

  // إعادة ترتيب صفوف الجسم: بالسحب أو بالأسهم
  function reorder(fromKey: string, toKey: string) {
    setT((s) => {
      const order = [...s.fieldOrder];
      const from = order.indexOf(fromKey), to = order.indexOf(toKey);
      if (from < 0 || to < 0 || from === to) return s;
      order.splice(to, 0, order.splice(from, 1)[0]);
      return { ...s, fieldOrder: order };
    });
  }
  function move(key: string, dir: 1 | -1) {
    setT((s) => {
      const order = [...s.fieldOrder];
      const i = order.indexOf(key), j = i + dir;
      if (j < 0 || j >= order.length) return s;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...s, fieldOrder: order };
    });
  }

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true); setSaved(false);
    const res = await fetch("/api/receipt-template", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...t, kind, officeId: officeSel ? Number(officeSel) : null }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); if (officeSel) setOfficeCustom(true); }
  }

  async function resetOffice() {
    if (!officeSel) return;
    if (!confirm("إزالة قالب هذا المكتب والعودة لقالب الوكيل العام؟")) return;
    const res = await fetch(`/api/receipt-template?officeId=${officeSel}&kind=${kind}`, { method: "DELETE" });
    if (res.ok) load(officeSel, kind);
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("receipt.template")) {
    return <div className="p-6"><PageHeader title="قالب الوصل المطبوع" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية تعديل قالب الوصل المطبوع.</div></div>;
  }

  const sheet = t.paperW > 0 && t.paperH > 0;

  return (
    <div className="p-6">
      <PageHeader title="قالب الوصل المطبوع" subtitle="أبعاد الورق يدويّاً، وأيّ معلومةٍ تظهر وترتيبها — والمعاينة تُطابق الطباعة" />

      {/* مبدّل نوع القالب (طلب محمد 2026-08-09): وصل الاشتراك · «وصل المشترك» لوصولات صفحة كلّ المشتركين */}
      <div className="mb-3 flex max-w-5xl flex-wrap items-center gap-2">
        <button onClick={() => setKind("receipt")}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${!isNotice ? "bg-mynet-blue text-white shadow" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
          🧾 وصل الاشتراك
        </button>
        <button onClick={() => setKind("notice")}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${isNotice ? "bg-mynet-blue text-white shadow" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
          👥 وصل المشترك (وصولات قائمة المشتركين)
        </button>
        {isNotice && <span className="text-[11px] text-slate-500">قالبٌ مستقلّ — كلّ حقولِه اختياريّة (منها «العنوان/ادرس 1»).</span>}
      </div>

      {/* مبدّل المكتب: قالب الوصل معزول لكل مكتب — قالب المكتب يغلب قالب الوكيل العام */}
      <div className="mb-4 flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-sm font-semibold text-slate-600">🏢 قالب:</span>
        <select value={officeSel} onChange={(e) => setOfficeSel(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-mynet-blue">
          <option value="">عام لكل المكاتب (الوكيل)</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `مكتب ${o.id}`}</option>)}
        </select>
        {officeSel && (officeCustom
          ? <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">مخصّص لهذا المكتب</span>
          : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">يتبع القالب العام — الحفظ يجعله مخصّصاً</span>)}
        {officeSel && officeCustom && (
          <button onClick={resetOffice} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">استخدام القالب العام</button>
        )}
      </div>

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        {/* المحرّر */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* أبعاد الورق — يدويّة */}
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-700">أبعاد الورق (مليمتر)</div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="عرض الورقة" value={t.paperW} min={PAPER_LIMITS.minW} max={PAPER_LIMITS.maxW}
                onChange={(v) => setT((s) => ({ ...s, paperW: v, contentW: Math.min(s.contentW, v) }))} />
              <NumField label="عرض الكتابة (موسَّط)" value={t.contentW} min={PAPER_LIMITS.minC} max={t.paperW}
                onChange={(v) => set("contentW", Math.min(v, t.paperW))} />
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={sheet}
                onChange={(e) => set("paperH", e.target.checked ? 297 : 0)} className="h-4 w-4 accent-mynet-blue" />
              ورق مقصوص بطولٍ ثابت (بدل لفّة حراريّة)
            </label>
            {sheet && (
              <div className="mt-2">
                <NumField label="طول الورقة" value={t.paperH} min={PAPER_LIMITS.minH} max={PAPER_LIMITS.maxH} onChange={(v) => set("paperH", v)} />
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              أمثلة: حراري ٨٠ (عرض ٨٠، كتابة ٦٨، لفّة) · A4 (عرض ٢١٠، كتابة ٧٨، طول ٢٩٧) · الكتابة تُطبع وسط الورقة.
            </p>
          </div>

          {/* طابعة الوصل — فارغ = الطابعة الافتراضية للحاسبة (سلوك حاليّ لبقية الوكلاء) */}
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-700">طابعة الوصل</div>
            <input list="rt-printers" value={t.printerName} onChange={(e) => set("printerName", e.target.value)}
              placeholder="الطابعة الافتراضية للحاسبة (اتركه فارغاً)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
            <datalist id="rt-printers">{printers.map((p) => <option key={p} value={p} />)}</datalist>
            {t.printerName && (
              <button onClick={() => set("printerName", "")} className="mt-1 text-xs text-red-500 hover:underline">إفراغ (استخدام الافتراضية)</button>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              {officeSel
                ? (printers.length
                    ? `اختر من طابعات حاسبة هذا المكتب (${printers.length}) أو اكتب الاسم. فارغ = الطابعة الافتراضية.`
                    : "اكتب اسم الطابعة كما يظهر في ويندوز — أو انتظر ظهور قائمة طابعات الحاسبة بعد نبضة عاملها. فارغ = الافتراضية.")
                : "اختر مكتباً محدّداً من الأعلى لرؤية طابعات حاسبته. الحقل الفارغ يعني الطابعة الافتراضية (سلوك حاليّ)."}
            </p>
          </div>

          {/* الحقول: إظهار/إخفاء + إعادة ترتيب بالسحب */}
          <div className="mb-4 rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-700">معلومات الوصل — أظهر/أخفِ ورتّب بالسحب</div>
            <ul className="space-y-1">
              {t.fieldOrder.map((key) => (
                <li key={key} draggable
                  onDragStart={() => setDragKey(key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragKey) reorder(dragKey, key); setDragKey(null); }}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${dragKey === key ? "border-mynet-blue bg-blue-50" : "border-slate-200 bg-white"}`}
                >
                  <span className="cursor-grab select-none text-slate-400" title="اسحب لإعادة الترتيب">⠿</span>
                  <input type="checkbox" checked={t.fields[key] !== false} onChange={(e) => setField(key, e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                  <span className={`flex-1 ${t.fields[key] === false ? "text-slate-400 line-through" : "text-slate-700"}`}>{FIELD_LABEL[key] ?? key}</span>
                  <button onClick={() => move(key, -1)} className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="أعلى">▲</button>
                  <button onClick={() => move(key, 1)} className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="أسفل">▼</button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-4 border-t border-slate-100 pt-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={t.showLogo} onChange={(e) => set("showLogo", e.target.checked)} className="h-4 w-4 accent-emerald-600" /> الشعار
              </label>
              {RECEIPT_TOGGLES.map((tg) => (
                <label key={tg.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={t.fields[tg.key] !== false} onChange={(e) => setField(tg.key, e.target.checked)} className="h-4 w-4 accent-emerald-600" /> {tg.label}
                </label>
              ))}
            </div>
          </div>

          <Field label="نص الترويسة (اسم المكتب)">
            <input value={t.headerText} onChange={(e) => set("headerText", e.target.value)} placeholder="SHAKEEB" className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
          </Field>
          <Field label="نص التذييل">
            <input value={t.footerText} onChange={(e) => set("footerText", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
          </Field>
          {/* عنوان المكتب: سطرٌ يُطبع أسفل نصّ التذييل (أرقام الهاتف) — طلب محمد 2026-08-09 */}
          <Field label="عنوان المكتب (يُطبع أسفل أرقام الهاتف)">
            <input value={t.addressText} onChange={(e) => set("addressText", e.target.value)}
              placeholder="مثال: شارع المواصلات — مقابل الجامع" className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
            <span className="mt-0.5 block text-[11px] text-slate-400">فارغ = لا يظهر. يخصّ قالب المكتب المختار أعلاه.</span>
          </Field>

          {t.showLogo && (
            <Field label="الشعار (صورة)">
              <input type="file" accept="image/*" onChange={onLogo} className="w-full text-sm" />
              {t.logo && <button onClick={() => set("logo", "")} className="mt-1 text-xs text-red-500 hover:underline">إزالة الشعار</button>}
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <ColorField label="لون الترويسة" value={t.headerColor} onChange={(v) => set("headerColor", v)} />
            <ColorField label="لون النص" value={t.fontColor} onChange={(v) => set("fontColor", v)} />
            <ColorField label="لون الخلفية" value={t.bgColor} onChange={(v) => set("bgColor", v)} />
          </div>
          <p className="mb-3 text-[11px] text-slate-400">الألوان تظهر عند فتح الوصل على الشاشة فقط؛ الطباعة أسود عريض على أبيض لوضوح الطابعة.</p>

          <Field label={`حجم الخط: ${t.fontSize}px`}>
            <input type="range" min={10} max={22} value={t.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} className="w-full" />
          </Field>

          {saved && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ تم حفظ القالب</div>}
          <button onClick={save} disabled={saving} className="w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
            {saving ? "جاري الحفظ..." : "حفظ القالب"}
          </button>
        </div>

        {/* المعاينة — مطابقة للطباعة: الورقة بنِسبها الحقيقيّة والمحتوى موسَّط */}
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-5 shadow-sm">
          <div className="mb-1 text-sm font-semibold text-slate-500">معاينة الطباعة — كما يخرج من الطابعة</div>
          <div className="mb-3 text-[11px] text-slate-400">
            عرض ورقة {t.paperW}مم{sheet ? ` × طول ${t.paperH}مم` : " (لفّة)"} · الكتابة {Math.min(t.contentW, t.paperW)}مم موسَّطة
          </div>
          <PrintPreview t={t} officeName={t.headerText || me?.agentName || "اسم المكتب"} />
        </div>
      </div>
    </div>
  );
}

// معاينة مطابقة للمطبوع: الورقة بعرضها الحقيقيّ (منسوبٌ للوحة)، المحتوى موسَّطٌ بنسبة
// contentW/paperW، والصفوف بترتيب fieldOrder وإظهار fields. أسود عريض على أبيض كالطابعة.
function PrintPreview({ t, officeName }: { t: Tpl; officeName: string }) {
  const PREVIEW_W = 360;
  const g = resolveDims(t);
  const mmToPx = PREVIEW_W / g.paperW;
  const sheet = g.paperH > 0;
  const paperH = sheet ? PREVIEW_W * (g.paperH / g.paperW) : undefined;
  const contentPx = g.contentW * mmToPx;
  const padXpx = g.padX * mmToPx;
  const padYpx = 3 * mmToPx;
  const fontPx = t.fontSize * mmToPx * 25.4 / 96;
  const F = t.fields;

  const SAMPLE: Record<string, [string, string, boolean?]> = {
    receiptNo: ["رقم الوصل", "#1024"],
    date: ["التاريخ", "2026/08/07"],
    subscriber: ["المشترك", "أحمد محمد"],
    phone: ["الهاتف", "0770 000 0000"],
    package: ["الباقة", "50 ميكا"],
    months: ["عدد الأشهر", "1"],
    dateFrom: ["من تاريخ", "2026/08/07"],
    dateTo: ["إلى تاريخ", "2026/09/06", true],
    price: ["قيمة الاشتراك", "25,000 د.ع"],
    moneyIn: ["المبلغ الواصل", "20,000 د.ع"],
    moneyCarry: ["الدين المتبقّي", "5,000 د.ع", true],
    // حقول «وصل المشترك» (وصولات قائمة المشتركين)
    netUser: ["اسم المستخدم", "bg-5-7-11@mu"],
    address: ["العنوان", "902 ع 3 ش9"],
    carry: ["الدين المتبقّي", "5,000 د.ع", true],
    office: ["المكتب", "مكتب المواصلات"],
  };

  return (
    <div className="overflow-auto">
      <div className="mx-auto shadow-lg ring-1 ring-slate-300" style={{ width: PREVIEW_W, height: paperH, minHeight: sheet ? undefined : 40, background: "#fff" }}>
        <div style={{ width: contentPx, maxWidth: contentPx, margin: "0 auto", padding: `${padYpx}px ${padXpx}px`, color: "#000", fontWeight: 700, fontSize: `${fontPx}px`, fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif', direction: "rtl" }}>
          <div style={{ textAlign: "center", borderBottom: "2px dashed #999", paddingBottom: "0.4em", marginBottom: "0.5em" }}>
            {t.showLogo && (
              t.logo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={t.logo} alt="شعار" style={{ maxHeight: 44 * mmToPx / (96 / 25.4), margin: "0 auto 0.3em", display: "block", objectFit: "contain" }} />
                : <div style={{ width: "2.6em", height: "2.6em", margin: "0 auto 0.3em", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0.4em", background: "#000", color: "#fff", fontWeight: 800 }}>نت</div>
            )}
            <div style={{ fontSize: "1.25em", fontWeight: 800 }}>{officeName}</div>
            {F.subtitle !== false && <div style={{ fontSize: "0.85em" }}>وصل تفعيل / تجديد اشتراك</div>}
          </div>
          {t.fieldOrder.filter((k) => F[k] !== false).map((key) => {
            if (key === "notes") return <div key={key} style={{ marginTop: "0.4em", border: "1px solid #999", borderRadius: 4, padding: "0.3em", fontSize: "0.85em" }}>ملاحظات: دفعة أولى</div>;
            const s = SAMPLE[key];
            return s ? <PreviewLine key={key} label={s[0]} value={s[1]} bold={s[2]} /> : null;
          })}
          {F.footer !== false && (
            <div style={{ marginTop: "0.6em", borderTop: "2px dashed #999", paddingTop: "0.4em", textAlign: "center", fontSize: "0.8em" }}>
              {t.footerText || "شكراً لاشتراككم"}{F.officeInFooter === true ? ` — ${officeName}` : ""}
              {t.addressText && <div>{t.addressText}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.06em 0" }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 700 }}>{value}</span>
    </div>
  );
}

function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label} <span className="text-slate-400">({min}–{max})</span></label>
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange(Math.min(Math.max(n, min), max)); }}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full cursor-pointer rounded border border-slate-300" />
    </div>
  );
}
