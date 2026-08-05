"use client";

// ===== مفتاح «بين تاريخين» (طلب محمد 2026-08-05) =====
// كان المدى الزمني مفروضاً في شاشات التقارير (من أول الشهر إلى اليوم) وشبه مفروضٍ في
// غيرها (يصلك الرابط بتاريخٍ فتُمسحه حقلين يدوياً) — فسؤالٌ بسيط مثل «كل النثرية بكل
// التواريخ» لم يكن له طريق مباشر. الآن: **الافتراض كل التواريخ**، ومن أراد مدىً فعّله.
export default function DateRangeFilter({
  on, setOn, from, setFrom, to, setTo, onChange, label = "بين تاريخين", className = "",
}: {
  on: boolean; setOn: (v: boolean) => void;
  from: string; setFrom: (v: string) => void;
  to: string; setTo: (v: string) => void;
  onChange?: (on: boolean, from: string, to: string) => void; // يُنادى بعد أي تغيير (لإعادة الجلب)
  label?: string; className?: string;
}) {
  const toggle = (v: boolean) => { setOn(v); onChange?.(v, from, to); };
  return (
    <div className={`flex flex-wrap items-end gap-3 ${className}`}>
      <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} className="h-4 w-4 accent-mynet-blue" />
        📅 {label}
        {!on && <span className="text-[11px] font-normal text-slate-400">(كل التواريخ)</span>}
      </label>
      {on && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">من تاريخ</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); onChange?.(true, e.target.value, to); }} dir="ltr"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">إلى تاريخ</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); onChange?.(true, from, e.target.value); }} dir="ltr"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
          </div>
        </>
      )}
    </div>
  );
}
