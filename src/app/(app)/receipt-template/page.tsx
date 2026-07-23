"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type Tpl = {
  headerText: string;
  footerText: string;
  logo: string;
  fontColor: string;
  bgColor: string;
  headerColor: string;
  fontSize: number;
  showLogo: boolean;
};

const DEFAULT: Tpl = {
  headerText: "", footerText: "شكراً لاشتراككم", logo: "",
  fontColor: "#1e293b", bgColor: "#ffffff", headerColor: "#1e66c9",
  fontSize: 14, showLogo: true,
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
      <PageHeader title="قالب الوصل المطبوع" subtitle="ترويسة وشعار وألوان الوصل الذي يُطبع للمشترك" />

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

          <Field label={`حجم الخط: ${t.fontSize}px`}>
            <input type="range" min={10} max={22} value={t.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} className="w-full" />
          </Field>

          {saved && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ تم حفظ القالب</div>}
          <button onClick={save} disabled={saving} className="w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
            {saving ? "جاري الحفظ..." : "حفظ القالب"}
          </button>
        </div>

        {/* المعاينة */}
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-500">معاينة الوصل</div>
          <div className="mx-auto w-full max-w-sm rounded-xl p-6 shadow-lg" style={{ backgroundColor: t.bgColor, color: t.fontColor, fontSize: `${t.fontSize}px` }}>
            <div className="mb-4 border-b-2 border-dashed border-slate-300 pb-3 text-center">
              {t.showLogo && (
                t.logo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={t.logo} alt="شعار" className="mx-auto mb-2 h-14 object-contain" />
                  : <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold text-white" style={{ backgroundColor: t.headerColor }}>نت</div>
              )}
              <h1 className="text-xl font-bold" style={{ color: t.headerColor }}>{t.headerText || "SHAKEEB"}</h1>
              <p className="text-sm text-slate-500">وصل تفعيل / تجديد اشتراك</p>
            </div>
            <div className="space-y-1.5">
              <Row label="رقم الوصل" value="#1024" />
              <Row label="المشترك" value="أحمد محمد" />
              <Row label="الباقة" value="50 ميكا" />
              <Row label="قيمة الاشتراك" value="25,000 د.ع" />
              <Row label="المبلغ الواصل" value="20,000 د.ع" />
              <Row label="الدين المتبقّي" value="5,000 د.ع" />
            </div>
            <div className="mt-5 border-t-2 border-dashed border-slate-300 pt-3 text-center text-xs text-slate-400">
              {t.footerText || "شكراً لاشتراككم"}
            </div>
          </div>
        </div>
      </div>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
