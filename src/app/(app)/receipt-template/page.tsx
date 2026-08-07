"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";
import { paperGeometry, PAPER_OPTIONS, paperLabel, DEFAULT_PAPER, type PaperKind } from "@/lib/receiptPaper";

type Tpl = {
  headerText: string;
  footerText: string;
  logo: string;
  fontColor: string;
  bgColor: string;
  headerColor: string;
  fontSize: number;
  showLogo: boolean;
  paper: PaperKind;
};

const DEFAULT: Tpl = {
  headerText: "", footerText: "شكراً لاشتراككم", logo: "",
  fontColor: "#1e293b", bgColor: "#ffffff", headerColor: "#1e66c9",
  fontSize: 14, showLogo: true, paper: DEFAULT_PAPER,
};

type Office = { id: number; name: string | null };

export default function ReceiptTemplatePage() {
  const { can, me } = usePermission();
  const [t, setT] = useState<Tpl>(DEFAULT);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // عزل قالب الوصل لكل مكتب: "" = قالب الوكيل العام، وإلا معرّف المكتب (قالبه يغلب العام)
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSel, setOfficeSel] = useState<string>("");
  const [officeCustom, setOfficeCustom] = useState(false);

  const load = (office: string) => {
    const qs = office ? `?officeId=${office}` : "";
    fetch(`/api/receipt-template${qs}`).then((r) => void (r.ok && r.json().then((d) => {
      setT({ ...DEFAULT, ...d });
      setOfficeCustom(!!d.officeCustom);
      setSaved(false);
      // موظف المكتب يُقيَّد بمكتبه من الخادم — نثبّت المبدّل عليه
      if (d.officeId != null && String(d.officeId) !== office) setOfficeSel(String(d.officeId));
    })));
  };
  useEffect(() => { load(officeSel); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [officeSel]);
  useEffect(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then((rows: Office[]) => setOffices(rows))));
  }, []);

  const set = <K extends keyof Tpl>(k: K, v: Tpl[K]) => setT((s) => ({ ...s, [k]: v }));

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
      body: JSON.stringify({ ...t, officeId: officeSel ? Number(officeSel) : null }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); if (officeSel) setOfficeCustom(true); }
  }

  // إزالة تخصيص المكتب: حذف قالبه فيعود لقالب الوكيل العام
  async function resetOffice() {
    if (!officeSel) return;
    if (!confirm("إزالة قالب هذا المكتب والعودة لقالب الوكيل العام؟")) return;
    const res = await fetch(`/api/receipt-template?officeId=${officeSel}`, { method: "DELETE" });
    if (res.ok) load(officeSel);
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("receipt.template")) {
    return <div className="p-6"><PageHeader title="قالب الوصل المطبوع" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية تعديل قالب الوصل المطبوع.</div></div>;
  }

  return (
    <div className="p-6">
      <PageHeader title="قالب الوصل المطبوع" subtitle="حجم الورقة والترويسة والشعار — والمعاينة تُطابق ما يخرج من الطابعة" />

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
          {/* حجم ورق الطابعة — لكل مكتب حسب طابعته */}
          <Field label="حجم ورق الطابعة">
            <div className="grid gap-2">
              {PAPER_OPTIONS.map((o) => (
                <label key={o.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.paper === o.value ? "border-mynet-blue bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="radio" name="paper" checked={t.paper === o.value} onChange={() => set("paper", o.value)} className="mt-0.5 h-4 w-4 accent-mynet-blue" />
                  <span>
                    <span className="font-semibold text-slate-700">{o.label}</span>
                    <span className="block text-[11px] text-slate-500">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="نص الترويسة (اسم المكتب)">
            <input value={t.headerText} onChange={(e) => set("headerText", e.target.value)} placeholder="SHAKEEB" className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
          </Field>
          <Field label="نص التذييل">
            <input value={t.footerText} onChange={(e) => set("footerText", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
          </Field>

          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={t.showLogo} onChange={(e) => set("showLogo", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            إظهار الشعار
          </label>
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
            {(() => { const g = paperGeometry(t.paper); return `${paperLabel(t.paper)} — عرض ${g.pageW}مم${g.pageH ? ` × طول ${g.pageH}مم` : " (لفّة)"} · الوصل ${g.contentW}مم موسَّط`; })()}
          </div>
          <PrintPreview t={t} officeName={t.headerText || me?.agentName || "اسم المكتب"} />
        </div>
      </div>
    </div>
  );
}

// معاينة مطابقة للمطبوع: ترسم الورقة بعرضها الحقيقيّ (منسوبٌ للوحة) والمحتوى موسَّطٌ فيها
// بنفس نسبة contentW/pageW، والخط منسوبٌ للمليمتر الحقيقيّ ⇒ الحراريّة شريطٌ ممتلئ،
// وA4 عمودٌ ضيّق وسط صفحةٍ واسعة — تماماً كالطباعة. أسود عريض على أبيض كالطابعة.
function PrintPreview({ t, officeName }: { t: Tpl; officeName: string }) {
  const PREVIEW_W = 360; // عرض تمثيل الورقة على اللوحة (px)
  const g = paperGeometry(t.paper);
  const mmToPx = PREVIEW_W / g.pageW;
  const sheet = g.pageH > 0;
  const paperH = sheet ? PREVIEW_W * (g.pageH / g.pageW) : undefined;
  const contentPx = g.contentW * mmToPx;
  const padXpx = g.padX * mmToPx;
  const padYpx = 3 * mmToPx;
  const fontPx = t.fontSize * mmToPx * 25.4 / 96; // px الشاشة = px القالب(96dpi) بنسبة الورقة

  return (
    <div className="overflow-auto">
      <div
        className="mx-auto shadow-lg ring-1 ring-slate-300"
        style={{ width: PREVIEW_W, height: paperH, minHeight: sheet ? undefined : 40, background: "#fff" }}
      >
        <div style={{ width: contentPx, maxWidth: contentPx, margin: "0 auto", padding: `${padYpx}px ${padXpx}px`, color: "#000", fontWeight: 700, fontSize: `${fontPx}px`, fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif', direction: "rtl" }}>
          <div style={{ textAlign: "center", borderBottom: "2px dashed #999", paddingBottom: "0.4em", marginBottom: "0.5em" }}>
            {t.showLogo && (
              t.logo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={t.logo} alt="شعار" style={{ maxHeight: 44 * mmToPx / (96 / 25.4), margin: "0 auto 0.3em", display: "block", objectFit: "contain" }} />
                : <div style={{ width: "2.6em", height: "2.6em", margin: "0 auto 0.3em", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0.4em", background: "#000", color: "#fff", fontWeight: 800 }}>نت</div>
            )}
            <div style={{ fontSize: "1.25em", fontWeight: 800 }}>{officeName}</div>
            <div style={{ fontSize: "0.85em" }}>وصل تفعيل / تجديد اشتراك</div>
          </div>
          <PreviewLine label="رقم الوصل" value="#1024" />
          <PreviewLine label="المشترك" value="أحمد محمد" />
          <PreviewLine label="الباقة" value="50 ميكا" />
          <PreviewLine label="عدد الأشهر" value="1" />
          <div style={{ borderTop: "1px dashed #bbb", margin: "0.35em 0" }} />
          <PreviewLine label="قيمة الاشتراك" value="25,000 د.ع" />
          <PreviewLine label="المبلغ الواصل" value="20,000 د.ع" />
          <PreviewLine label="الدين المتبقّي" value="5,000 د.ع" bold />
          <div style={{ marginTop: "0.6em", borderTop: "2px dashed #999", paddingTop: "0.4em", textAlign: "center", fontSize: "0.8em" }}>
            {t.footerText || "شكراً لاشتراككم"} — {officeName}
          </div>
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
