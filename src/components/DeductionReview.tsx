"use client";

import { useCallback, useEffect, useState } from "react";

type Adj = {
  id: number; technicianId: number; technicianName: string; kind: string; source: string;
  amount: number; reason: string; overrunMin: number | null; status: string; dayKey: string; decidedBy: string | null;
};
type Tech = { id: number; name: string };
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "معلّق", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "مؤكّد", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "ملغى", cls: "bg-slate-200 text-slate-500" },
};
const num = (n: number) => Number(n).toLocaleString("en-US");

// مراجعة الخصومات (تجاوز الوقت) + إضافة خصم/مكافأة يدوية للفني.
export default function DeductionReview({ officeId, officeName, onClose, onChange }: { officeId: number | null; officeName: string; onClose: () => void; onChange: () => void }) {
  const [rows, setRows] = useState<Adj[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  // نموذج الخصم اليدوي
  const [openForm, setOpenForm] = useState(false);
  const [fTech, setFTech] = useState("");
  const [fKind, setFKind] = useState<"deduction" | "bonus">("deduction");
  const [fAmount, setFAmount] = useState("");
  const [fReason, setFReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const q = officeId != null ? `?officeId=${officeId}` : "";
    fetch(`/api/field/adjustments${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.adjustments ?? []));
    fetch(`/api/field/technicians${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTechs(d.technicians ?? []));
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: number, status: "confirmed" | "rejected") {
    setBusyId(id);
    const r = await fetch("/api/field/adjustments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { alert(d.error ?? "تعذّر"); return; }
    load(); onChange();
  }
  async function addManual() {
    setMsg("");
    if (!fTech) { setMsg("اختر الفني"); return; }
    if (!fAmount || Number(fAmount) <= 0) { setMsg("أدخل مبلغاً صحيحاً"); return; }
    if (!fReason.trim()) { setMsg("السبب مطلوب"); return; }
    setBusy(true);
    const r = await fetch("/api/field/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId: Number(fTech), kind: fKind, amount: Number(fAmount), reason: fReason.trim() }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر الحفظ"); return; }
    setFTech(""); setFAmount(""); setFReason(""); setFKind("deduction"); setOpenForm(false); load(); onChange();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">💠 خصومات {officeName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        {/* إضافة خصم/مكافأة يدوية */}
        {!openForm ? (
          <button onClick={() => { setOpenForm(true); setMsg(""); }} className="mb-4 w-full rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 py-3.5 text-base font-extrabold text-white shadow-md active:scale-[0.99]">➕ خصم / مكافأة يدوية</button>
        ) : (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {msg && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</div>}
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              <button onClick={() => setFKind("deduction")} className={`rounded-lg py-2.5 text-sm font-bold transition ${fKind === "deduction" ? "bg-rose-600 text-white shadow" : "text-slate-500"}`}>خصم</button>
              <button onClick={() => setFKind("bonus")} className={`rounded-lg py-2.5 text-sm font-bold transition ${fKind === "bonus" ? "bg-emerald-600 text-white shadow" : "text-slate-500"}`}>مكافأة</button>
            </div>
            <label className="mb-0.5 block text-xs font-semibold text-slate-500">الفني</label>
            <select value={fTech} onChange={(e) => setFTech(e.target.value)} className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue">
              <option value="">— اختر —</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label className="mb-0.5 block text-xs font-semibold text-slate-500">المبلغ (د.ع)</label>
            <input type="number" min={1} value={fAmount} onChange={(e) => setFAmount(e.target.value)} dir="ltr" className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue" />
            <label className="mb-0.5 block text-xs font-semibold text-slate-500">السبب</label>
            <textarea value={fReason} onChange={(e) => setFReason(e.target.value)} rows={2} placeholder="سبب الخصم/المكافأة…" className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue" />
            <div className="flex gap-2">
              <button onClick={addManual} disabled={busy} className="flex-1 rounded-xl bg-mynet-blue py-2.5 font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">{busy ? "..." : "حفظ"}</button>
              <button onClick={() => setOpenForm(false)} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        )}

        <div className="mb-2 text-sm font-bold text-amber-700">المعلّقة ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-400">لا خصومات معلّقة</div>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="rounded-2xl border border-amber-200 bg-white p-3.5 shadow-sm">
                <Row a={a} />
                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => decide(a.id, "confirmed")} disabled={busyId === a.id} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">تأكيد الخصم</button>
                  <button onClick={() => decide(a.id, "rejected")} disabled={busyId === a.id} className="flex-1 rounded-xl bg-slate-400 py-2.5 text-sm font-bold text-white hover:bg-slate-500 disabled:opacity-60">إلغاء</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <>
            <div className="mb-2 text-sm font-bold text-slate-600">مقرّرة سابقاً</div>
            <ul className="space-y-2">
              {decided.map((a) => {
                const st = STATUS[a.status] ?? STATUS.pending;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
                    <div className="min-w-0"><Row a={a} compact /></div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ a, compact }: { a: Adj; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`font-bold ${a.kind === "deduction" ? "text-rose-700" : "text-emerald-700"} ${compact ? "text-sm" : "text-base"}`}>
        👷 {a.technicianName} · {a.kind === "deduction" ? "خصم" : "مكافأة"} <b>{num(a.amount)}</b> د.ع
        {a.source === "manual" && <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">يدوي</span>}
      </div>
      <div className={`mt-0.5 text-slate-500 ${compact ? "truncate text-xs" : "text-sm"}`}>{a.reason}<span className="mr-2 text-slate-400" dir="ltr">{a.dayKey}</span></div>
    </div>
  );
}
