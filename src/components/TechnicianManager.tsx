"use client";

import { useCallback, useEffect, useState } from "react";
import SalaryModal from "./SalaryModal";

type Tech = {
  id: number; name: string; phone: string | null; username: string | null; plainCode?: string | null;
  salary?: number | null; shiftStart?: string | null; shiftEnd?: string | null;
  entryGraceMin?: number | null; exitGraceMin?: number | null; lateRatePerMin?: number | null; overtimeRatePerMin?: number | null; paidLeavesPerMonth?: number | null; missedCheckoutPenalty?: number | null;
};
type Form = Record<string, string>;
const EMPTY: Form = { name: "", username: "", code: "", phone: "", salary: "", shiftStart: "", shiftEnd: "", entryGraceMin: "0", exitGraceMin: "0", lateRatePerMin: "0", overtimeRatePerMin: "0", paidLeavesPerMonth: "0", missedCheckoutPenalty: "0" };

// إدارة الفنيين للمدير: إضافة/تعديل بكل الإعدادات + حذف نهائي + بصمة خروج يدوية.
export default function TechnicianManager({ officeId, officeName, onClose, onChange }: { officeId: number | null; officeName: string; onClose: () => void; onChange: () => void }) {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [f, setF] = useState<Form>(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [salaryTech, setSalaryTech] = useState<Tech | null>(null);

  const load = useCallback(() => {
    fetch(`/api/field/technicians${officeId != null ? `?officeId=${officeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTechs(d.technicians ?? []));
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  function startAdd() { setEditId(null); setF(EMPTY); setOpenForm(true); setMsg(""); }
  function startEdit(t: Tech) {
    setEditId(t.id);
    setF({
      name: t.name ?? "", username: t.username ?? "", code: "", phone: t.phone ?? "",
      salary: String(t.salary ?? ""), shiftStart: t.shiftStart ?? "", shiftEnd: t.shiftEnd ?? "",
      entryGraceMin: String(t.entryGraceMin ?? 0), exitGraceMin: String(t.exitGraceMin ?? 0),
      lateRatePerMin: String(t.lateRatePerMin ?? 0), overtimeRatePerMin: String(t.overtimeRatePerMin ?? 0), paidLeavesPerMonth: String(t.paidLeavesPerMonth ?? 0),
      missedCheckoutPenalty: String(t.missedCheckoutPenalty ?? 0),
    });
    setOpenForm(true); setMsg("");
  }

  async function save() {
    setBusy(true); setMsg("");
    const body: Record<string, unknown> = { ...f, officeId };
    if (editId) body.id = editId;
    const r = await fetch("/api/field/technicians", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setOpenForm(false); setF(EMPTY); setEditId(null); load(); onChange(); }
    else setMsg(d.error ?? "تعذّر الحفظ");
  }
  async function del(t: Tech) {
    if (!confirm(`حذف الفني «${t.name}» نهائياً من قاعدة البيانات؟ لا يمكن التراجع.`)) return;
    const r = await fetch(`/api/field/technicians?id=${t.id}`, { method: "DELETE" });
    if (r.ok) { load(); onChange(); } else alert("تعذّر الحذف");
  }
  async function manualOut(t: Tech, mode: "now" | "scheduled") {
    const r = await fetch("/api/field/attendance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId: t.id, mode }) });
    const d = await r.json().catch(() => ({}));
    alert(r.ok ? "تم تسجيل خروج الفني" : (d.error ?? "تعذّر"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">👷 فنيّو {officeName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        {!openForm && (
          <button onClick={startAdd} className="mb-4 w-full rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 py-3.5 text-base font-extrabold text-white shadow-md active:scale-[0.99]">➕ إضافة فني جديد</button>
        )}

        {openForm && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-bold text-slate-700">{editId ? "تعديل فني" : "فني جديد"}</div>
            {msg && <div className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{msg}</div>}
            <div className="grid grid-cols-2 gap-2">
              <L label="اسم الفني"><I v={f.name} on={(v) => set("name", v)} /></L>
              <L label="الهاتف (اختياري)"><I v={f.phone} on={(v) => set("phone", v)} ltr /></L>
              <L label="اسم المستخدم (فريد)"><I v={f.username} on={(v) => set("username", v)} ltr /></L>
              <L label={editId ? "رمز الدخول (اتركه فارغاً لإبقائه)" : "رمز الدخول"}><I v={f.code} on={(v) => set("code", v)} ltr /></L>
              <L label="الراتب الشهري"><I v={f.salary} on={(v) => set("salary", v)} num /></L>
              <L label="عدد إجازات الراتب/شهر"><I v={f.paidLeavesPerMonth} on={(v) => set("paidLeavesPerMonth", v)} num /></L>
              <L label="بداية الدوام"><I v={f.shiftStart} on={(v) => set("shiftStart", v)} time /></L>
              <L label="نهاية الدوام"><I v={f.shiftEnd} on={(v) => set("shiftEnd", v)} time /></L>
              <L label="سماحية الدخول (دقيقة)"><I v={f.entryGraceMin} on={(v) => set("entryGraceMin", v)} num /></L>
              <L label="سماحية الخروج (دقيقة)"><I v={f.exitGraceMin} on={(v) => set("exitGraceMin", v)} num /></L>
              <L label="سعر دقيقة الخصم"><I v={f.lateRatePerMin} on={(v) => set("lateRatePerMin", v)} num /></L>
              <L label="سعر دقيقة الإضافي"><I v={f.overtimeRatePerMin} on={(v) => set("overtimeRatePerMin", v)} num /></L>
              <L label="غرامة نسيان الخروج"><I v={f.missedCheckoutPenalty} on={(v) => set("missedCheckoutPenalty", v)} num /></L>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={busy} className="flex-1 rounded-lg bg-mynet-blue py-2 font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">{busy ? "..." : "حفظ"}</button>
              <button onClick={() => { setOpenForm(false); setEditId(null); }} className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        )}

        {techs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">لا يوجد فنيون بعد</div>
        ) : (
          <ul className="space-y-3">
            {techs.map((t) => (
              <li key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {/* معلومات الفني */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl">👷</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold text-slate-800">{t.name}</div>
                    <div className="truncate text-xs text-slate-500" dir="ltr">👤 {t.username ?? "—"}{t.plainCode ? ` · 🔑 ${t.plainCode}` : ""}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{t.shiftStart && t.shiftEnd ? `⏰ ${t.shiftStart}–${t.shiftEnd}` : "بلا دوام"} · راتب {Number(t.salary ?? 0).toLocaleString("en-US")}</div>
                  </div>
                </div>
                {/* الخيارات — مربعات واضحة */}
                <div className="grid grid-cols-3 gap-2">
                  <Act onClick={() => setSalaryTech(t)} cls="bg-emerald-50 text-emerald-700" icon="💰" label="الراتب" />
                  <Act onClick={() => startEdit(t)} cls="bg-sky-50 text-sky-700" icon="✏️" label="تعديل" />
                  <Act onClick={() => del(t)} cls="bg-rose-50 text-rose-600" icon="🗑️" label="حذف" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Act onClick={() => manualOut(t, "now")} cls="bg-amber-50 text-amber-700" icon="🕐" label="خروج الآن" />
                  <Act onClick={() => manualOut(t, "scheduled")} cls="bg-amber-50 text-amber-700" icon="⏰" label="خروج بوقته" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {salaryTech && (
        <SalaryModal technicianId={salaryTech.id} name={salaryTech.name} onClose={() => setSalaryTech(null)} onSettled={onChange} />
      )}
    </div>
  );
}

// زر إجراء كمربّع واضح (أيقونة فوق التسمية)
function Act({ onClick, cls, icon, label }: { onClick: () => void; cls: string; icon: string; label: string }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 rounded-xl py-2.5 font-bold transition active:scale-95 ${cls}`}>
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-slate-500">{label}</span>{children}</label>;
}
function I({ v, on, ltr, num, time }: { v: string; on: (s: string) => void; ltr?: boolean; num?: boolean; time?: boolean }) {
  return <input value={v} onChange={(e) => on(e.target.value)} dir={ltr || num || time ? "ltr" : undefined} type={num ? "number" : time ? "time" : "text"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-mynet-blue" />;
}
