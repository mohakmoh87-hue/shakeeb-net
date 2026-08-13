"use client";

import { useCallback, useEffect, useState } from "react";

type Leave = {
  id: number; technicianId: number; technicianName: string; kind: string; paid: boolean;
  dayKey: string; startMin: number | null; endMin: number | null; reason: string;
  status: string; decidedBy: string | null;
};
const minToHHMM = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "قيد المراجعة", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "مقبولة", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "مرفوضة", cls: "bg-red-100 text-red-600" },
};

// مراجعة المدير لطلبات الإجازة — قبول/رفض (المعلّق أولاً).
export default function LeaveReview({ officeId, officeName, onClose, onChange }: { officeId: number | null; officeName: string; onClose: () => void; onChange: () => void }) {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch(`/api/field/leaves${officeId != null ? `?officeId=${officeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLeaves(d.leaves ?? []));
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: number, status: "approved" | "rejected") {
    setBusyId(id);
    const r = await fetch("/api/field/leaves", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { alert(d.error ?? "تعذّر"); return; }
    load(); onChange();
  }

  // ═════ أ-٨ · إزالةُ إجازةٍ أُدخلت خطأً ═════
  // لم يكن لها طريقٌ إطلاقاً: المعلَّقةُ تُرفَض، والمعتمدةُ **تبقى إلى الأبد**.
  // والخادمُ يرفض إزالةَ إجازةٍ محسوبةٍ في كشفِ راتبٍ مُسدَّد — فيُنقَل نصُّه كما هو.
  async function remove(l: Leave) {
    const what = l.kind === "day" ? `إجازة يوم ${l.paid ? "براتب" : "بلا راتب"}` : "إجازة زمنية";
    if (!confirm(`إزالةُ «${what}» لـ${l.technicianName} بتاريخ ${l.dayKey}؟\n\n`
      + (l.paid ? "• يُرجَع يومُها إلى الحصّة، ويزول مبلغُها من راتبه.\n" : "• لا أثرَ ماليّ.\n")
      + "• تبقى في السجلّ مع اسمِك ووقتِ الإزالة (إزالةٌ ناعمةٌ لا محوٌ).")) return;
    setBusyId(l.id);
    const r = await fetch(`/api/field/leaves?id=${l.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { alert(d.error ?? "تعذّر الإزالة"); return; }
    load(); onChange();
  }

  const pending = leaves.filter((l) => l.status === "pending");
  const decided = leaves.filter((l) => l.status !== "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">📅 إجازات {officeName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        {/* ═════ أ-٨ · المديرُ يمنح إجازةً بنفسه ولمدّةٍ (طلبُ محمد) ═════
            كان `POST` يلزم جلسةَ فنيّ فيردّ ٤٠١ للمدير ⇒ لا سبيلَ لمنحِ إجازةٍ إلّا أن
            يفتح الفنيُّ تطبيقَه ويطلبها. وما يمنحه المديرُ **معتمَدٌ من لحظته**. */}
        <GrantLeave officeId={officeId} onDone={() => { load(); onChange(); }} />

        <div className="mb-2 text-sm font-bold text-amber-700">المعلّقة ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-400">لا طلبات معلّقة</div>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((l) => (
              <li key={l.id} className="rounded-2xl border border-amber-200 bg-white p-3.5 shadow-sm">
                <Row l={l} />
                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => decide(l.id, "approved")} disabled={busyId === l.id} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">قبول</button>
                  <button onClick={() => decide(l.id, "rejected")} disabled={busyId === l.id} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">رفض</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <>
            <div className="mb-2 text-sm font-bold text-slate-600">مقرّرة سابقاً</div>
            <ul className="space-y-2">
              {decided.map((l) => {
                const st = STATUS[l.status] ?? STATUS.pending;
                return (
                  <li key={l.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
                    <div className="min-w-0"><Row l={l} compact /></div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                      {/* أ-٨ · إزالةُ ما أُدخل خطأً — والمرفوضةُ لا تُزال (لا أثرَ لها) */}
                      {l.status === "approved" && (
                        <button
                          onClick={() => remove(l)} disabled={busyId === l.id}
                          title="إزالةُ الإجازة (تبقى في السجلّ باسمِك)"
                          className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >🗑 إزالة</button>
                      )}
                    </div>
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

function Row({ l, compact }: { l: Leave; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`font-bold text-slate-800 ${compact ? "text-sm" : "text-base"}`}>
        👷 {l.technicianName}
        <span className="mr-2 font-normal text-slate-500">
          {l.kind === "day" ? `إجازة يوم ${l.paid ? "براتب" : "بلا راتب"}` : `إجازة زمنية ${minToHHMM(l.startMin)}–${minToHHMM(l.endMin)}`}
        </span>
        <span className="font-normal text-slate-400" dir="ltr"> {l.dayKey}</span>
      </div>
      <div className={`text-slate-500 ${compact ? "truncate text-[11px]" : "text-xs"}`}>السبب: {l.reason}</div>
    </div>
  );
}

// ═════ أ-٨ · منحُ إجازةٍ من المدير: فنيٌّ + مدىً + براتبٍ أو بلا + سبب ═════
// مطويٌّ افتراضيّاً فلا يُزحم شاشةَ المراجعة، ويُفتَح بزرٍّ واحد.
function GrantLeave({ officeId, onDone }: { officeId: number | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [techs, setTechs] = useState<{ id: number; name: string | null }[]>([]);
  const [techId, setTechId] = useState<number | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paid, setPaid] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const q = officeId != null ? `?officeId=${officeId}` : "";
    fetch(`/api/field/technicians${q}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTechs(d.technicians ?? [])).catch(() => {});
  }, [open, officeId]);

  async function submit() {
    if (techId === "") { setMsg({ t: "err", m: "اختر الفنيّ" }); return; }
    if (!from) { setMsg({ t: "err", m: "حدّد تاريخ البداية" }); return; }
    if (!reason.trim()) { setMsg({ t: "err", m: "السببُ مطلوب" }); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/field/leaves", {
      method: "POST", headers: { "Content-Type": "application/json" },
      // `to` يُهمَل إن كان فارغاً ⇒ الخادمُ يجعله = `from` (يومٌ واحد)
      body: JSON.stringify({ technicianId: techId, from, ...(to ? { to } : {}), paid, reason: reason.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر المنح" }); return; }
    setMsg({
      t: "ok",
      m: `✓ مُنحت ${d.created} إجازة${d.paid ? " براتب" : " بلا راتب"} لـ${d.technicianName ?? ""}`
        + (d.skipped ? ` — وتُخطّيت ${d.skipped} أيّامٍ لها إجازةٌ سلفاً` : ""),
    });
    setReason(""); setTo("");
    onDone();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mb-3 w-full rounded-xl bg-mynet-blue py-2.5 text-sm font-bold text-white hover:opacity-90">
        ➕ منحُ إجازةٍ لفنيّ
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-2xl border border-mynet-blue/30 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-bold text-slate-800">➕ منحُ إجازة</div>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="text-xs text-slate-400 hover:text-slate-600">إغلاق</button>
      </div>

      <select value={techId} onChange={(e) => setTechId(e.target.value === "" ? "" : Number(e.target.value))}
        className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
        <option value="">— اختر الفنيّ —</option>
        {techs.map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
      </select>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-slate-500">
          من
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-0.5 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm" dir="ltr" />
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          إلى <span className="font-normal text-slate-400">(اتركه فارغاً ليومٍ واحد)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined}
            className="mt-0.5 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm" dir="ltr" />
        </label>
      </div>

      <div className="mb-2 flex gap-2">
        {([true, false] as const).map((p) => (
          <button key={String(p)} onClick={() => setPaid(p)}
            className={`flex-1 rounded-xl py-2 text-xs font-bold ${paid === p ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600"}`}>
            {p ? "براتب (من حصّته)" : "بلا راتب"}
          </button>
        ))}
      </div>

      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="السبب (إلزاميّ)"
        className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />

      {msg && (
        <div className={`mb-2 rounded-xl px-3 py-2 text-[11px] font-semibold ${msg.t === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {msg.m}
        </div>
      )}

      <button onClick={submit} disabled={busy}
        className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
        {busy ? "جارٍ المنح…" : "منحُ الإجازة (معتمَدةً)"}
      </button>
      <div className="mt-1.5 text-[10px] leading-4 text-slate-400">
        تُسجَّل معتمَدةً باسمِك فوراً — فأنت صاحبُ الاعتماد. والمدى يُنشئ صفّاً لكلّ يوم،
        وأيُّ يومٍ له إجازةٌ سلفاً يُتخطّى بلا تكرار.
      </div>
    </div>
  );
}
