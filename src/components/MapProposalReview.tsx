"use client";

import { useCallback, useEffect, useState } from "react";

// ===== مراجعة مواقع الأعمدة التي أرسلها الفنيون (طلب محمد 2026-08-05) =====
// الفني واقفٌ عند العمود فيُرسل إحداثيه؛ وهنا يراه المدير على الخريطة قبل أن يقبله.
// القبول يكتبه في الخريطة الدائمة، والرفض يُغلقه بسببٍ يُكتب — ولا شيء يُكتب بلا قرار.
type Row = {
  id: number; name: string; lat: number; lng: number; accuracy: number | null;
  netUser: string | null; subscriber: string | null; office: string | null;
  byName: string | null; status: string; note: string | null;
  createdAt: string; decidedAt: string | null; gmaps: string;
};

export default function MapProposalReview({ onClose, onChange }: { onClose: () => void; onChange?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback((all: boolean) => {
    fetch(`/api/field/map-proposal${all ? "?all=1" : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setRows(d.rows ?? []); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(showAll); }, [load, showAll]);

  async function decide(id: number, action: "accept" | "reject") {
    const note = action === "reject" ? (prompt("سبب الرفض (اختياري):") ?? "") : "";
    setBusy(id); setMsg("");
    const r = await fetch("/api/field/map-proposal", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setMsg(d.error ?? "تعذّر التنفيذ"); load(showAll); return; }
    setMsg(action === "accept" ? `✓ أُضيف العمود ${d.name} إلى الخريطة نهائياً` : "أُغلق الاقتراح بالرفض");
    load(showAll);
    onChange?.();
  }

  const badge = (s: string) =>
    s === "accepted" ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">قُبل</span>
    : s === "rejected" ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">رُفض</span>
    : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">بانتظارك</span>;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">📍 مواقع أعمدة بانتظار قبولك</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-3.5 w-3.5 accent-sky-600" />
          إظهار المحسومة أيضاً (المقبولة والمرفوضة)
        </label>

        {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{msg}</div>}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
            لا مواقع بانتظار القبول
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-extrabold text-slate-800" dir="ltr">{r.name}</div>
                  {badge(r.status)}
                </div>
                <div className="text-xs text-slate-500">
                  {r.office ?? "—"} · المشترك: {r.subscriber ?? r.netUser ?? "—"}
                  {r.netUser && r.subscriber ? <span dir="ltr"> ({r.netUser})</span> : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  أرسله: <b className="text-slate-700">{r.byName ?? "—"}</b>
                  {r.accuracy != null && <> · دقّة الجهاز ≈ {Math.round(r.accuracy)} م</>}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400" dir="ltr">{r.lat.toFixed(6)}, {r.lng.toFixed(6)}</div>
                {r.note && <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500">{r.note}</div>}

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <a href={r.gmaps} target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-1 rounded-xl bg-sky-50 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100">🗺️ عايِنه</a>
                  {r.status === "pending" ? (
                    <>
                      <button onClick={() => decide(r.id, "accept")} disabled={busy === r.id}
                        className="rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">✓ قبول وإضافة</button>
                      <button onClick={() => decide(r.id, "reject")} disabled={busy === r.id}
                        className="rounded-xl bg-rose-50 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-60">✕ رفض</button>
                    </>
                  ) : (
                    <div className="col-span-2 self-center text-center text-[11px] text-slate-400">
                      {r.decidedAt ? new Date(r.decidedAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 text-[11px] leading-5 text-slate-400">
          القبول يضيف العمود إلى الخريطة الدائمة فيراه كل الفنيين فوراً. ولا يُكتب فوق عمودٍ موجود أبداً.
        </div>
      </div>
    </div>
  );
}
