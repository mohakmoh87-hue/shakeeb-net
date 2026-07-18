"use client";

import { useState } from "react";

type Office = { id: number; name: string | null };

// قائمة التطبيق المنسدلة الأنيقة (وضع standalone فقط) — تجمع المكاتب والأدوات
// المبعثرة في زرٍّ واحد + نافذة سفلية احترافية. لا تظهر في المتصفح.
export default function FieldAppMenu({
  offices, officeId, onSelectOffice, canManage, canTechs, techCount, leavePending, dedPending,
  onTechs, onTypes, onLeaves, onDeductions, onSupport,
}: {
  offices: Office[]; officeId: number | null; onSelectOffice: (id: number) => void;
  canManage: boolean; canTechs?: boolean; techCount: number; leavePending: number; dedPending: number;
  onTechs: () => void; onTypes: () => void; onLeaves: () => void; onDeductions: () => void; onSupport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const totalBadge = leavePending + dedPending;
  const currentOffice = offices.find((o) => o.id === officeId)?.name ?? "اختر مكتباً";

  const tools = [
    // «الفنيون» تظهر للمدير ولمستخدم المكتب (تتبع الموقع)؛ بقية الأدوات للمدير فقط
    ...((canManage || canTechs) ? [
      { key: "techs", icon: "👷", label: "الفنيون", sub: `${techCount}`, badge: 0, cls: "from-emerald-600 to-emerald-800", on: onTechs },
    ] : []),
    ...(canManage ? [
      { key: "leaves", icon: "📅", label: "الإجازات", sub: "طلبات", badge: leavePending, cls: "from-amber-500 to-amber-700", on: onLeaves },
      { key: "ded", icon: "💠", label: "الخصومات", sub: "معلّقة", badge: dedPending, cls: "from-rose-600 to-rose-800", on: onDeductions },
      { key: "types", icon: "⏱", label: "الأنواع والأوقات", sub: "إعداد", badge: 0, cls: "from-slate-600 to-slate-800", on: onTypes },
    ] : []),
    ...(officeId != null ? [{ key: "support", icon: "🤝", label: "دعم مؤقت", sub: "فنّي مُعار", badge: 0, cls: "from-teal-600 to-teal-800", on: onSupport }] : []),
  ];

  const pick = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <>
      {/* الشريط السفلي: زر قائمة واحد أنيق */}
      <div className="border-t border-white/15 bg-black/25 px-4 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          onClick={() => setOpen(true)}
          className="relative flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/95 font-extrabold text-mynet-blue shadow-lg active:scale-[0.99] transition"
        >
          <span className="text-lg">☰</span> القائمة
          <span className="mx-1 text-xs font-normal text-slate-400">·</span>
          <span className="max-w-[45%] truncate text-sm font-semibold text-slate-500">{currentOffice}</span>
          {totalBadge > 0 && (
            <span className="absolute left-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white ring-2 ring-white">{totalBadge}</span>
          )}
        </button>
      </div>

      {/* النافذة السفلية */}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-slate-50 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* مقبض */}
            <div className="sticky top-0 z-10 flex flex-col items-center bg-slate-50 pt-2.5">
              <div className="mb-2 h-1.5 w-12 rounded-full bg-slate-300" />
            </div>

            <div className="px-5 pb-4">
              {/* المكاتب */}
              <div className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-400">
                <span>🏢 المكاتب</span><div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="mb-4 space-y-1.5">
                {offices.map((o) => {
                  const active = o.id === officeId;
                  return (
                    <button
                      key={o.id}
                      onClick={() => pick(() => onSelectOffice(o.id))}
                      className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-right text-sm font-bold transition ${active ? "bg-mynet-blue text-white shadow" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      <span className="truncate">{o.name ?? `مكتب ${o.id}`}</span>
                      {active && <span className="text-base">✓</span>}
                    </button>
                  );
                })}
              </div>

              {/* الأدوات */}
              {tools.length > 0 && (
                <>
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-400">
                    <span>🧰 الأدوات</span><div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {tools.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => pick(t.on)}
                        className={`relative flex flex-col items-start gap-1 rounded-2xl bg-gradient-to-br ${t.cls} p-3.5 text-right text-white shadow-md active:scale-[0.98] transition`}
                      >
                        <span className="text-2xl leading-none">{t.icon}</span>
                        <span className="text-sm font-extrabold">{t.label}</span>
                        <span className="text-[11px] font-medium text-white/80">{t.sub}</span>
                        {t.badge > 0 && (
                          <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-rose-600 shadow">{t.badge}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
