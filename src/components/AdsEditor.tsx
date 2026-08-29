"use client";

// محرّرُ إعلانات/عروض/اختصارات التطبيق — **مكوّنٌ مشترَك** يستعمله المالكُ (/owner/supercell)
// والشركةُ (/supercell) على **نفس المخزَن** (طلبُ محمد: نفسُ الإعلان من مكانين). طلبُ محمد 2026-08-29.
import { useState } from "react";

export type Ad = { text: string; image: string };
export type AppContentT = { ads: Record<string, Ad>; offers: Ad[]; quick: string[] };

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

export default function AdsEditor({ content, onChange }: { content: AppContentT; onChange: (c: AppContentT) => void }) {
  const setAd = (slot: string, patch: Partial<Ad>) =>
    onChange({ ...content, ads: { ...content.ads, [slot]: { ...content.ads[slot], ...patch } } });
  const setOffer = (i: number, patch: Partial<Ad>) =>
    onChange({ ...content, offers: content.offers.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-800">الإعلانات (نصّ + صورة)</div>
        <div className="space-y-4">
          {AD_SLOTS.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-2 text-[12px] font-bold text-mynet-blue">{label}</div>
              <textarea value={content.ads[key]?.text ?? ""} onChange={(e) => setAd(key, { text: e.target.value })}
                rows={2} maxLength={400} placeholder="نصّ الإعلان (اختياري)…"
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <ImageField value={content.ads[key]?.image ?? ""} onChange={(v) => setAd(key, { image: v })} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold text-slate-800">العروض والباقات (تظهر في «الباقات والعروض»)</span>
          <button type="button" onClick={() => onChange({ ...content, offers: [...content.offers, { text: "", image: "" }] })}
            className="rounded-lg bg-mynet-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-mynet-blue-dark">+ عرض</button>
        </div>
        <div className="space-y-3">
          {content.offers.length === 0 && <div className="text-xs text-slate-400">لا عروضَ — أضف واحداً.</div>}
          {content.offers.map((o, i) => (
            <div key={i} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">عرض {i + 1}</span>
                <button type="button" onClick={() => onChange({ ...content, offers: content.offers.filter((_, j) => j !== i) })}
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
          {content.quick.map((q, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700">
              {q}
              <button type="button" onClick={() => onChange({ ...content, quick: content.quick.filter((_, j) => j !== i) })}
                className="text-sky-400 hover:text-red-500">✕</button>
            </span>
          ))}
          <button type="button" onClick={() => {
            const v = prompt("اسمُ الاختصار (مثل: طلب صيانة)")?.trim();
            if (v) onChange({ ...content, quick: [...content.quick, v].slice(0, 8) });
          }} className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50">+ إضافة</button>
        </div>
      </div>
    </>
  );
}
