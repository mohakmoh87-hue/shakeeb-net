"use client";

// ⚙️ تحكّمُ المالك ببوّابة سوبر سيل وإعلانات التطبيق (طلبُ محمد 2026-08-29) — صفحةٌ جديدةٌ معزولة
// تحت حارس المالك (src/app/owner/layout.tsx). تقرأ/تكتب مخزَن appConfig عبر /api/owner/supercell،
// وهو نفسُ المخزَن الذي يقرؤه التطبيقُ (GET /api/app/config) وستحرّره صفحةُ الشركة لاحقاً.

import { useCallback, useEffect, useState } from "react";

type Ad = { text: string; image: string };
type Content = { ads: Record<string, Ad>; offers: Ad[]; quick: string[] };
type State = Content & { companyMode: boolean; portalEnabled: boolean };

const AD_SLOTS: { key: string; label: string }[] = [
  { key: "hero", label: "إعلان الرئيسية (البطل)" },
  { key: "home2", label: "إعلان الرئيسية (الثاني)" },
  { key: "plan", label: "إعلان صفحة الباقة" },
  { key: "activate", label: "إعلان صفحة التفعيل" },
];
const MAX_IMG = 300_000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("تعذّرت قراءة الصورة"));
    r.readAsDataURL(file);
  });
}

function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [err, setErr] = useState("");
  return (
    <div className="flex items-center gap-2">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="h-12 w-12 rounded-lg border border-slate-200 object-cover" />
      ) : (
        <div className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-400">لا صورة</div>
      )}
      <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">
        اختر صورة
        <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return; setErr("");
          const url = await fileToDataUrl(f).catch(() => "");
          if (!url.startsWith("data:image/")) { setErr("صورة غير صالحة"); return; }
          if (url.length > MAX_IMG) { setErr("الصورة كبيرة — اختر أصغر"); return; }
          onChange(url);
        }} />
      </label>
      {value && <button type="button" onClick={() => onChange("")} className="text-xs text-red-500 hover:underline">إزالة</button>}
      {err && <span className="text-xs text-red-500">{err}</span>}
    </div>
  );
}

export default function OwnerSupercellPage() {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/owner/supercell").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setS(d); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!s) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  const setAd = (slot: string, patch: Partial<Ad>) =>
    setS({ ...s, ads: { ...s.ads, [slot]: { ...s.ads[slot], ...patch } } });
  const setOffer = (i: number, patch: Partial<Ad>) =>
    setS({ ...s, offers: s.offers.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  async function save() {
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/owner/supercell", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { ads: s!.ads, offers: s!.offers, quick: s!.quick },
          companyMode: s!.companyMode, portalEnabled: s!.portalEnabled,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error ?? "فشل الحفظ"); return; }
      setMsg("✓ حُفِظ — يظهرُ في التطبيق حيّاً");
      load();
    } catch { setMsg("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }

  const Toggle = ({ on, onFlip, label, hint }: { on: boolean; onFlip: () => void; label: string; hint: string }) => (
    <button type="button" onClick={onFlip} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-right hover:bg-slate-50">
      <div>
        <div className="font-semibold text-slate-800">{label}</div>
        <div className="text-[11px] text-slate-500">{hint}</div>
      </div>
      <span className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "right-0.5" : "right-5"}`} />
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">🏢 بوّابة سوبر سيل والتطبيق</h1>
        <a href="/owner" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">← رجوع</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle on={s.portalEnabled} onFlip={() => setS({ ...s, portalEnabled: !s.portalEnabled })}
          label="تفعيل بوّابة سوبر سيل" hint="مطفأة ⇒ صفحةُ /supercell مغلقةٌ تماماً (404)" />
        <Toggle on={s.companyMode} onFlip={() => setS({ ...s, companyMode: !s.companyMode })}
          label="وضع الشركة" hint="مطفأ ⇒ يختفي كلُّ ما يخصّ الشركة، والطلباتُ للوكيل فقط" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-800">الإعلانات (نصّ + صورة)</div>
        <div className="space-y-4">
          {AD_SLOTS.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-2 text-[12px] font-bold text-mynet-blue">{label}</div>
              <textarea value={s.ads[key]?.text ?? ""} onChange={(e) => setAd(key, { text: e.target.value })}
                rows={2} maxLength={400} placeholder="نصّ الإعلان (اختياري)…"
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <ImageField value={s.ads[key]?.image ?? ""} onChange={(v) => setAd(key, { image: v })} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold text-slate-800">العروض والباقات (تظهر في «الباقات والعروض»)</span>
          <button type="button" onClick={() => setS({ ...s, offers: [...s.offers, { text: "", image: "" }] })}
            className="rounded-lg bg-mynet-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-mynet-blue-dark">+ عرض</button>
        </div>
        <div className="space-y-3">
          {s.offers.length === 0 && <div className="text-xs text-slate-400">لا عروضَ — أضف واحداً.</div>}
          {s.offers.map((o, i) => (
            <div key={i} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">عرض {i + 1}</span>
                <button type="button" onClick={() => setS({ ...s, offers: s.offers.filter((_, j) => j !== i) })}
                  className="text-xs text-red-500 hover:underline">حذف</button>
              </div>
              <textarea value={o.text} onChange={(e) => setOffer(i, { text: e.target.value })} rows={2} maxLength={400}
                placeholder="نصّ العرض…" className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <ImageField value={o.image} onChange={(v) => setOffer(i, { image: v })} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-800">اختصاراتُ الطلب السريعة</div>
        <div className="flex flex-wrap gap-2">
          {s.quick.map((q, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700">
              {q}
              <button type="button" onClick={() => setS({ ...s, quick: s.quick.filter((_, j) => j !== i) })}
                className="text-sky-400 hover:text-red-500">✕</button>
            </span>
          ))}
          <button type="button" onClick={() => {
            const v = prompt("اسمُ الاختصار (مثل: طلب صيانة)")?.trim();
            if (v) setS({ ...s, quick: [...s.quick, v].slice(0, 8) });
          }} className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50">+ إضافة</button>
        </div>
      </div>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-mynet-blue px-6 py-2 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
      </div>
    </div>
  );
}
