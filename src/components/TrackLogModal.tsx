"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { fmtClock, type TrackStopMarker } from "./TrackMap";

const TrackMap = dynamic(() => import("./TrackMap"), { ssr: false });

type DayRow = { dayKey: string; count: number; first: string | null; last: string | null };
type Pt = { lat: number; lng: number; at: string; acc: number | null };

// سجل تتبّع فنيّ (للمدير): قائمة أيّام آخر شهر ← عند اختيار يوم يُعرض مساره على الخريطة
// مع دبابيس التوقّفات (أطول من ٥ دقائق) وقائمتها. لا تتبّع حيّ هنا — قراءة تاريخيّة فقط.
export default function TrackLogModal({ technicianId, techName, onClose }: { technicianId: number; techName: string; onClose: () => void }) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [stops, setStops] = useState<TrackStopMarker[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDays, setLoadingDays] = useState(true);

  useEffect(() => {
    setLoadingDays(true);
    fetch(`/api/field/track/log?technicianId=${technicianId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.days) setDays(d.days); })
      .catch(() => {})
      .finally(() => setLoadingDays(false));
  }, [technicianId]);

  const openDay = useCallback((dk: string) => {
    setDay(dk); setLoading(true); setPoints([]); setStops([]);
    fetch(`/api/field/track/log?technicianId=${technicianId}&dayKey=${dk}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setPoints(d.points ?? []); setStops(d.stops ?? []); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [technicianId]);

  const path: [number, number][] = points.map((p) => [p.lat, p.lng]);
  const fmtRange = (a: string | null, b: string | null) => (a && b ? `${fmtClock(a)} — ${fmtClock(b)}` : "");

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h3 className="truncate text-lg font-bold text-slate-800">🗺️ سجل التتبع — {techName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        {!day ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <p className="pb-3 text-[11px] leading-relaxed text-slate-500">اختر يوماً لعرض مسار الفنيّ وتوقّفاته (أطول من ٥ دقائق). تُحفظ النقاط شهراً ثم تُحذف تلقائياً.</p>
            {loadingDays ? (
              <div className="py-10 text-center text-sm text-slate-400">…جارٍ التحميل</div>
            ) : days.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">لا سجلّ تتبّع لهذا الفنيّ بعد.</div>
            ) : (
              <ul className="space-y-2">
                {days.map((d) => (
                  <li key={d.dayKey}>
                    <button onClick={() => openDay(d.dayKey)} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-sky-300 hover:bg-sky-50">
                      <span className="text-sm font-bold text-slate-800" dir="ltr">{d.dayKey}</span>
                      <span className="text-[11px] text-slate-500">{fmtRange(d.first, d.last)} · {d.count} نقطة</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row-reverse">
            <div className="relative min-h-[45vh] flex-1 md:min-h-0">
              <TrackMap points={[]} path={path} stops={stops} className="h-full w-full" />
              {loading && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-slate-500">…جارٍ التحميل</div>}
              {!loading && path.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-center text-sm text-slate-400">لا نقاطَ لهذا اليوم</div>}
            </div>
            <div className="flex max-h-[35vh] shrink-0 flex-col border-t border-slate-200 bg-white md:max-h-none md:w-72 md:border-l md:border-t-0">
              <div className="flex items-center justify-between px-3 py-2">
                <button onClick={() => setDay(null)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200">▸ الأيّام</button>
                <span className="text-xs font-bold text-slate-700" dir="ltr">{day}</span>
              </div>
              <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500">التوقّفات ({stops.length})</div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {stops.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">{loading ? "…" : "لا توقّفات أطول من ٥ دقائق"}</div>
                ) : (
                  <ul className="space-y-1.5">
                    {stops.map((s, i) => (
                      <li key={i} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                          <span>⏱ {s.minutes} دقيقة</span>
                          <span className="font-normal text-slate-500" dir="ltr">{fmtClock(s.startedAt)}–{fmtClock(s.endedAt)}</span>
                        </div>
                        {s.pole && <div className="mt-0.5 text-[11px] text-slate-500" dir="ltr">📍 {s.pole}{s.poleDistM != null ? ` · ${s.poleDistM}م` : ""}</div>}
                        <a href={`https://maps.google.com/?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-bold text-sky-700 hover:underline">🧭 كوكل ماب</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
