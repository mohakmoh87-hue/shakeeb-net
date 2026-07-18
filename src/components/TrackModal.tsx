"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TechRef = { id: number; name: string };
type Loc = { id: number; name: string; lat: number | null; lng: number | null; at: string | null; fresh: boolean };

// نافذة تتبع موقع الفنيين (مدير/مستخدم المكتب):
// - التتبع بالطلب فقط: المحدَّدون تُبعث لهم نبضة كل 30ث وتُعرض مواقعهم؛ غير المحدَّدين خاملون
// - إغلاق النافذة أو إلغاء التحديد ⇒ إيقاف فوري + مسح آخر موقع نهائياً من القاعدة
export default function TrackModal({ techs, initialIds, onClose }: { techs: TechRef[]; initialIds: number[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialIds));
  const [locs, setLocs] = useState<Map<number, Loc>>(new Map());
  const [focusId, setFocusId] = useState<number | null>(initialIds[0] ?? null);
  const [, forceTick] = useState(0); // لتحديث «منذ كم ثانية»
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // نبضة التتبع + جلب المواقع (فوراً وكل 30ث)
  const beat = useCallback(async () => {
    const ids = [...selectedRef.current];
    if (ids.length === 0) { setLocs(new Map()); return; }
    const r = await fetch("/api/field/track", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianIds: ids }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.locations) setLocs(new Map((d.locations as Loc[]).map((l) => [l.id, l])));
  }, []);

  useEffect(() => {
    beat();
    const t = setInterval(beat, 30_000);
    const tick = setInterval(() => forceTick((x) => x + 1), 5_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [beat]);
  useEffect(() => { beat(); }, [selected, beat]);

  // إيقاف نهائي عند إغلاق النافذة (fetch) وعند إغلاق الصفحة فجأة (sendBeacon)
  const stopAll = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    fetch("/api/field/track", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianIds: ids }), keepalive: true }).catch(() => {});
  }, []);
  useEffect(() => {
    const onHide = () => {
      const ids = [...selectedRef.current];
      if (ids.length) navigator.sendBeacon?.("/api/field/track", new Blob([JSON.stringify({ action: "stop", technicianIds: ids })], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); stopAll([...selectedRef.current]); };
  }, [stopAll]);

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); stopAll([id]); setLocs((m) => { const mm = new Map(m); mm.delete(id); return mm; }); if (focusId === id) setFocusId(null); }
      else { n.add(id); if (focusId == null) setFocusId(id); }
      return n;
    });
  }
  function selectAll() { setSelected(new Set(techs.map((t) => t.id))); if (focusId == null && techs[0]) setFocusId(techs[0].id); }
  function stopEveryone() { stopAll([...selectedRef.current]); setSelected(new Set()); setLocs(new Map()); setFocusId(null); }

  const ago = (at: string | null) => {
    if (!at) return null;
    const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
    return s < 60 ? `قبل ${s} ثانية` : `قبل ${Math.round(s / 60)} دقيقة`;
  };

  const focus = focusId != null ? locs.get(focusId) : null;
  const hasPos = focus && focus.lat != null && focus.lng != null;
  const bbox = hasPos ? `${focus!.lng! - 0.005},${focus!.lat! - 0.003},${focus!.lng! + 0.005},${focus!.lat! + 0.003}` : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h3 className="text-lg font-bold text-slate-800">📍 تتبع الفنيين</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>
        <p className="px-5 pb-2 text-[11px] leading-relaxed text-slate-500">
          يتحدّث الموقع كل دقيقة ويستبدل السابق (لا يُحفظ أي سجل). يتطلّب أن يكون تطبيق الفني مفتوحاً في هاتفه. إغلاق هذه النافذة يوقف التتبع ويمسح المواقع نهائياً.
        </p>

        <div className="flex gap-2 px-5 pb-2">
          <button onClick={selectAll} className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white active:scale-[0.98]">✓ تتبع الجميع ({techs.length})</button>
          <button onClick={stopEveryone} className="flex-1 rounded-xl bg-slate-200 py-2 text-sm font-bold text-slate-600 active:scale-[0.98]">⏹ إيقاف الكل</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {/* قائمة الفنيين */}
          <ul className="mb-3 space-y-2">
            {techs.map((t) => {
              const on = selected.has(t.id);
              const l = locs.get(t.id);
              const has = on && l && l.lat != null;
              return (
                <li key={t.id}
                  onClick={() => { if (on && has) setFocusId(t.id); }}
                  className={`rounded-2xl border p-3 transition ${focusId === t.id && on ? "border-mynet-blue bg-white shadow" : on ? "border-emerald-200 bg-white" : "border-slate-200 bg-slate-100/60"} ${on && has ? "cursor-pointer" : ""}`}>
                  <div className="flex items-center gap-3">
                    <button onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
                      className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${on ? "justify-end bg-emerald-500" : "justify-start bg-slate-300"}`}>
                      <span className="h-6 w-6 rounded-full bg-white shadow" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-slate-800">👷 {t.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {!on ? "التتبع متوقف" : has ? <><span className={l!.fresh ? "text-emerald-600" : "text-amber-600"}>{l!.fresh ? "🟢 موقع حيّ" : "🟡 موقع قديم"}</span> · {ago(l!.at)}</> : "⏳ بانتظار أول موقع… (يجب أن يكون تطبيقه مفتوحاً)"}
                      </div>
                    </div>
                    {on && has && (
                      <a href={`https://maps.google.com/?q=${l!.lat},${l!.lng}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[11px] font-bold text-sky-700 hover:bg-sky-100">🧭 كوكل ماب</a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* الخريطة المدمجة للفني المُركَّز عليه */}
          {hasPos && bbox ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                <span>🗺️ {focus!.name}</span>
                <span className="font-normal text-slate-400">{ago(focus!.at)}</span>
              </div>
              <iframe
                title="خريطة الفني"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${focus!.lat},${focus!.lng}`}
                className="h-64 w-full border-0"
                loading="lazy"
              />
            </div>
          ) : selected.size > 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
              ستظهر الخريطة هنا فور وصول أول موقع — اضغط على فني له موقع لعرضه.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
