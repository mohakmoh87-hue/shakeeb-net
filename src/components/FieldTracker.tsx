"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { TrackPoint } from "./TrackMap";

const TrackMap = dynamic(() => import("./TrackMap"), { ssr: false });

type Tech = { id: number; name: string; towerId: number | null; office: string };
type Loc = { id: number; name: string; lat: number | null; lng: number | null; at: string | null; fresh: boolean; pole?: string | null };

type Ctx = {
  techs: Tech[];
  manager: boolean;
  selected: Set<number>;
  toggle: (id: number) => void;
  selectAll: () => void;
  clearAll: () => void;
  locs: Map<number, Loc>;
  points: TrackPoint[];
  activeCount: number;
  openBig: () => void;
  ago: (at: string | null) => string | null;
};

const TrackerCtx = createContext<Ctx | null>(null);
export function useTracker() { return useContext(TrackerCtx); }

// مزوّد حالة تتبّع الفنيين: يجلب القائمة (معزولة بالوكيل)، يدير الاختيار والنبضة،
// ويعرض الطبقات العائمة (زر الهاتف + النافذة الكبيرة). اللوحة الجانبية تستهلك السياق.
export function FieldTrackerProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [manager, setManager] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [locs, setLocs] = useState<Map<number, Loc>>(new Map());
  const [big, setBig] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false); // سطح المكتب: دبوس ↔ لوحة الخريطة
  const [, tick] = useState(0);
  const selRef = useRef(selected);
  selRef.current = selected;
  const panelRef = useRef<HTMLDivElement | null>(null);

  // إغلاق اللوحة العائمة عند النقر خارجها (تعود دبوساً)
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelOpen]);

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/field/trackable-techs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setTechs(d.technicians ?? []); setManager(!!d.manager); } })
      .catch(() => {});
  }, [enabled]);

  const beat = useCallback(async () => {
    const ids = [...selRef.current];
    if (ids.length === 0) { setLocs(new Map()); return; }
    const r = await fetch("/api/field/track", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianIds: ids }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.locations) setLocs(new Map((d.locations as Loc[]).map((l) => [l.id, l])));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    beat();
    const t = setInterval(beat, 30_000);
    const tk = setInterval(() => tick((x) => x + 1), 5_000);
    return () => { clearInterval(t); clearInterval(tk); };
  }, [beat, enabled]);
  useEffect(() => { beat(); }, [selected, beat]);

  const stop = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    fetch("/api/field/track", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianIds: ids }), keepalive: true }).catch(() => {});
  }, []);
  useEffect(() => {
    const onHide = () => { const ids = [...selRef.current]; if (ids.length) navigator.sendBeacon?.("/api/field/track", new Blob([JSON.stringify({ action: "stop", technicianIds: ids })], { type: "application/json" })); };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); stop([...selRef.current]); };
  }, [stop]);

  const toggle = (id: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); stop([id]); setLocs((m) => { const mm = new Map(m); mm.delete(id); return mm; }); }
      else n.add(id);
      return n;
    });
  };
  const selectAll = () => setSelected(new Set(techs.map((t) => t.id)));
  const clearAll = () => { stop([...selRef.current]); setSelected(new Set()); setLocs(new Map()); };

  const points: TrackPoint[] = useMemo(
    () => [...selected].map((id) => locs.get(id)).filter((l): l is Loc => !!l && l.lat != null && l.lng != null).map((l) => ({ id: l.id, name: l.name, lat: l.lat as number, lng: l.lng as number, fresh: l.fresh, pole: l.pole ?? null })),
    [selected, locs],
  );
  const ago = (at: string | null) => {
    if (!at) return null;
    const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
    return s < 60 ? `قبل ${s}ث` : `قبل ${Math.round(s / 60)}د`;
  };

  const ctx: Ctx = { techs, manager, selected, toggle, selectAll, clearAll, locs, points, activeCount: points.length, openBig: () => setBig(true), ago };

  return (
    <TrackerCtx.Provider value={ctx}>
      {children}
      {enabled && techs.length > 0 && (
        <>
          {/* زر عائم على الهاتف/التطبيق — يفتح النافذة الكبيرة */}
          <button onClick={() => setBig(true)} className="fixed bottom-24 right-4 z-[45] flex items-center gap-1.5 rounded-full bg-sky-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-xl active:scale-95 md:hidden">
            📍 تتبع {ctx.activeCount > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{ctx.activeCount}</span>}
          </button>

          {/* سطح المكتب: دبوس أسفل اليسار ↔ لوحة الخريطة (بحجمها الحالي)، تُغلَق بالنقر خارجها */}
          {!panelOpen ? (
            <button onClick={() => setPanelOpen(true)} className="fixed bottom-4 left-4 z-[45] hidden items-center gap-1.5 rounded-full bg-sky-600 px-4 py-3 text-sm font-extrabold text-white shadow-xl hover:bg-sky-700 md:flex" title="فتح خريطة التتبّع">
              📍 تتبع الفنيين {ctx.activeCount > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{ctx.activeCount}</span>}
            </button>
          ) : (
            <div ref={panelRef} className="fixed bottom-4 left-4 z-[46] hidden h-[70vh] max-h-[44rem] w-[24rem] md:block">
              <FieldTrackerPanel onCollapse={() => setPanelOpen(false)} />
            </div>
          )}

          {big && <BigModal ctx={ctx} onClose={() => setBig(false)} />}
        </>
      )}
    </TrackerCtx.Provider>
  );
}

// أسماء الفنيين على خطّ أفقي (مربّعات صح)
function Chips({ ctx }: { ctx: Ctx }) {
  const { techs, selected, toggle, locs } = ctx;
  return (
    <>
      {techs.map((t) => {
        const on = selected.has(t.id);
        const l = locs.get(t.id);
        const has = on && l && l.lat != null;
        return (
          <label key={t.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${on ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            <input type="checkbox" checked={on} onChange={() => toggle(t.id)} className="h-3.5 w-3.5 accent-emerald-600" />
            <span className="whitespace-nowrap">{t.name}</span>
            {on && (has ? <span>{l!.fresh ? "🟢" : "🟡"}</span> : <span className="text-slate-400">⏳</span>)}
          </label>
        );
      })}
    </>
  );
}

// اللوحة الجانبية داخل تخطيط الصفحة (سطح المكتب) — تحجز مكانها ولا تطفو فوق الأعمدة.
export function FieldTrackerPanel({ onCollapse }: { onCollapse?: () => void }) {
  const ctx = useTracker();
  if (!ctx || ctx.techs.length === 0) return null;
  const { techs, selectAll, clearAll, points, activeCount, openBig } = ctx;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between bg-gradient-to-l from-sky-600 to-sky-700 px-3 py-2 text-white">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">📍 تتبع الفنيين {activeCount > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{activeCount}</span>}</span>
        <div className="flex items-center gap-1">
          <button onClick={selectAll} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-bold hover:bg-white/25">تتبّع الكل ({techs.length})</button>
          <button onClick={clearAll} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-bold hover:bg-white/25">إيقاف الكل</button>
          <button onClick={openBig} className="rounded-md px-1.5 py-0.5 text-xs hover:bg-white/20" title="تكبير">⛶</button>
          {onCollapse && <button onClick={onCollapse} className="rounded-md px-1.5 py-0.5 text-sm hover:bg-white/20" title="طيّ إلى دبوس">▾</button>}
        </div>
      </div>
      {/* أسماء الفنيين على خطّ أفقي فوق الخريطة */}
      <div className="flex max-h-28 flex-wrap content-start gap-1.5 overflow-y-auto border-b border-slate-100 px-3 py-2"><Chips ctx={ctx} /></div>
      {/* الخريطة تملأ ما تبقّى من ارتفاع اللوحة */}
      <div className="relative min-h-0 flex-1">
        <TrackMap points={points} className="h-full w-full" />
        {points.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 px-3 text-center text-sm text-slate-400">اختر فنّياً من الأعلى لعرض موقعه على الخريطة</div>}
      </div>
    </div>
  );
}

// النافذة الكبيرة (متصفح + تطبيق) — خريطة كل المؤشّرات + قائمة جانبية، وزر إغلاق أعلى اليسار.
function BigModal({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { techs, manager, selected, toggle, selectAll, clearAll, locs, points, activeCount, ago } = ctx;
  const groups = useMemo(() => {
    const m = new Map<string, Tech[]>();
    for (const t of techs) { const k = t.office || "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(t); }
    return [...m.entries()];
  }, [techs]);

  const list = (
    <div className="space-y-2">
      {(manager && groups.length > 1 ? groups : [["", techs] as [string, Tech[]]]).map(([office, arr]) => (
        <div key={office || "all"}>
          {manager && groups.length > 1 && <div className="mb-1 mt-1 text-[11px] font-bold text-slate-400">🏢 {office}</div>}
          <div className="space-y-1">
            {arr.map((t) => {
              const on = selected.has(t.id);
              const l = locs.get(t.id);
              const has = on && l && l.lat != null;
              return (
                <label key={t.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 ${on ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(t.id)} className="h-4 w-4 accent-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">👷 {t.name}</span>
                  {on && <span className="shrink-0 text-[10px]">{has ? <span className={l!.fresh ? "text-emerald-600" : "text-amber-600"}>{l!.fresh ? "🟢" : "🟡"} {ago(l!.at)}</span> : <span className="text-slate-400">⏳ بانتظار…</span>}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[85] flex flex-col bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:h-[92vh] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5" data-app-safetop>
          <h3 className="text-base font-extrabold text-slate-800">📍 تتبع الفنيين {activeCount > 0 && `(${activeCount})`}</h3>
          {/* زر الإغلاق أعلى اليسار (آخر عنصر ⇒ يسار في RTL) */}
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-200">✕ إغلاق</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row-reverse">
          <div className="relative min-h-[45vh] flex-1 md:min-h-0">
            <TrackMap points={points} className="h-full w-full" />
            {points.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-center text-sm text-slate-400">اختر فنّياً واحداً أو أكثر لعرض مواقعهم</div>}
          </div>
          <div className="flex max-h-[35vh] shrink-0 flex-col border-t border-slate-200 bg-white md:max-h-none md:w-72 md:border-l md:border-t-0">
            <div className="flex gap-2 p-3">
              <button onClick={selectAll} className="flex-1 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white">تتبّع الكل ({techs.length})</button>
              <button onClick={clearAll} className="flex-1 rounded-xl bg-slate-200 py-2 text-xs font-bold text-slate-600">إيقاف الكل</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{list}</div>
          </div>
        </div>
        <div className="border-t border-slate-200 bg-white px-4 py-2 text-center text-[11px] text-slate-400">
          يتحدّث كل 30 ثانية · يتطلّب أن يكون تطبيق الفني مفتوحاً أو موقظاً وإذن الموقع مفعّلاً · إغلاق النافذة يوقف الطلب ويُبقي آخر موقع
        </div>
      </div>
    </div>
  );
}
