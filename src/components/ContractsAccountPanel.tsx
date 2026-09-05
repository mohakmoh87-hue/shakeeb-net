"use client";

import { useCallback, useEffect, useState } from "react";

type Account = { id: number; sasPanelId: number | null; username: string; label: string | null };
type Office = { towerId: number; name: string; panelCount: number; accounts: Account[] };

function AddForm({ office, second, onSaved }: { office: Office; second: boolean; onSaved: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "verify" | "save">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(action: "verify" | "save") {
    if (!username.trim() || !password) { setMsg({ ok: false, text: "أدخل اليوزر والباسورد" }); return; }
    setBusy(action); setMsg(null);
    try {
      const r = await fetch("/api/manager/contracts-account", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, towerId: office.towerId, username, password, label: second ? "الثاني" : null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: d?.error ?? "تعذّر" }); return; }
      if (action === "verify") setMsg({ ok: true, text: `✅ الاعتماد صحيح — ${Number(d.count ?? 0).toLocaleString("en-US")} عقد` });
      else { setMsg({ ok: true, text: "✅ حُفظ" }); setUsername(""); setPassword(""); onSaved(); }
    } catch { setMsg({ ok: false, text: "تعذّر الاتصال بالخادم" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      {second && <div className="mb-1 text-[11px] font-bold text-indigo-700">موقع العقود الثاني (اللوحة الثانية)</div>}
      <div className="grid grid-cols-2 gap-2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="يوزر موقع العقود" dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="الباسورد" dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => call("verify")} disabled={!!busy} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          {busy === "verify" ? "جارٍ التحقّق…" : "🔎 تحقّق"}
        </button>
        <button onClick={() => call("save")} disabled={!!busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50">
          {busy === "save" ? "جارٍ الحفظ…" : "💾 حفظ"}
        </button>
        {msg && <span className={`text-xs font-semibold ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

function OfficeCard({ office, onChanged }: { office: Office; onChanged: () => void }) {
  const [addSecond, setAddSecond] = useState(false);
  const maxAccounts = office.panelCount >= 2 ? 2 : 1;
  const canAddFirst = office.accounts.length === 0;
  const canAddSecond = office.panelCount >= 2 && office.accounts.length === 1;

  async function disconnect(id: number) {
    if (!confirm("فصلُ موقع العقود لهذا المكتب؟")) return;
    await fetch("/api/manager/contracts-account", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }),
    }).catch(() => {});
    onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-extrabold text-slate-800">🏢 {office.name}</span>
        {office.accounts.length > 0
          ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">متّصل ✓</span>
          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">غير مُدخَل</span>}
      </div>
      {office.accounts.map((a) => (
        <div key={a.id} className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5">
          <span className="text-xs text-slate-600" dir="ltr">{a.username}{a.label ? ` · ${a.label}` : ""}</span>
          <button onClick={() => disconnect(a.id)} className="text-xs font-bold text-rose-600 hover:underline">فصل</button>
        </div>
      ))}
      {canAddFirst && <AddForm office={office} second={false} onSaved={onChanged} />}
      {canAddSecond && !addSecond && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-semibold text-indigo-700">
          <input type="checkbox" checked={addSecond} onChange={(e) => setAddSecond(e.target.checked)} />
          هل يوجد موقعُ عقودٍ آخر لهذا المكتب؟ (لوحةٌ ثانية)
        </label>
      )}
      {canAddSecond && addSecond && <AddForm office={office} second onSaved={() => { setAddSecond(false); onChanged(); }} />}
      {office.accounts.length >= maxAccounts && office.panelCount < 2 && <div className="mt-1 text-[11px] text-slate-400">مكتمل</div>}
    </div>
  );
}

export default function ContractsAccountPanel({ compact }: { compact?: boolean }) {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const load = useCallback(() => {
    fetch("/api/manager/contracts-account").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setOffices(d.offices ?? []); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (offices == null) return <div className="p-3 text-sm text-slate-400">…جارٍ التحميل</div>;
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <p className="text-xs leading-6 text-slate-500">
        موقعُ العقود هو مصدرُ <b>التنصيبات داخل المكتب</b>. أدخِل يوزر/باسورد موقع العقود لكلّ مكتب (اضغط <b>🔎 تحقّق</b> قبل الحفظ).
        عند تغيير الباسورد افصِل الاعتماد وأعِد إدخاله.
      </p>
      {offices.length === 0 ? <div className="text-sm text-slate-400">لا مكاتب</div> : offices.map((o) => <OfficeCard key={o.towerId} office={o} onChanged={load} />)}
    </div>
  );
}
