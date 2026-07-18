"use client";

import { useState } from "react";

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

// نافذة «إضافة ديون سابقة» — المبلغ المضاف + تفاصيله فقط، بلا تفعيل/كارت/باقة وبلا مكافأة.
export default function AddDebtModal({
  subscriber,
  onClose,
  onDone,
}: {
  subscriber: { id: number; name: string | null; netUser: string | null; carry: number | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const nAmount = Number(amount) || 0;
  const newDebt = (subscriber.carry ?? 0) + nAmount;

  async function submit() {
    setError("");
    if (nAmount <= 0) { setError("أدخل مبلغاً صحيحاً"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/subscribers/${subscriber.id}/add-debt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: nAmount, note: note || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "تعذّرت الإضافة"); return; }
      onDone();
    } catch { setError("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🅰️ إضافة ديون سابقة</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        <div className="mb-3 flex items-stretch gap-2">
          <div className="flex-1 rounded-lg bg-white px-3 py-1.5 text-center text-sm font-bold text-red-600 shadow-sm ring-1 ring-slate-200">{subscriber.name ?? "—"}</div>
          <div className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-center text-sm font-semibold text-slate-700" dir="ltr">{subscriber.netUser ?? "—"}</div>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ المضاف (د.ع)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" autoFocus />

        <label className="mb-1 block text-sm font-medium text-slate-700">تفاصيل المبلغ</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="سبب/تفاصيل الدين..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />

        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2">الدين الحالي: <b className="text-slate-700">{fmt(subscriber.carry)}</b></div>
          <div className="rounded-lg bg-red-50 px-3 py-2">مجموع الدين بعد الإضافة: <b className="text-red-600">{fmt(newDebt)}</b></div>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="flex gap-2">
          <button onClick={submit} disabled={saving || nAmount <= 0} className="flex-1 rounded-lg bg-red-600 py-2.5 font-bold text-white hover:bg-red-700 disabled:opacity-50">
            {saving ? "جارٍ الحفظ…" : "إضافة الدين"}
          </button>
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-5 py-2.5 font-semibold text-slate-600 hover:bg-slate-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
