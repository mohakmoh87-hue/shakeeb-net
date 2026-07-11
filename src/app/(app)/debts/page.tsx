"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import { usePermission } from "@/lib/usePermission";

type Debtor = {
  id: number;
  name: string | null;
  phone: string | null;
  carry: number | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? "0" : Number(n).toLocaleString("en-US");

export default function DebtsPage() {
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [total, setTotal] = useState(0);
  const [paying, setPaying] = useState<Debtor | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const { can } = usePermission();

  // مسح دين مشترك واحد أو المحددين (إسقاط الدين)
  async function clearDebts(ids: number[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`مسح دين ${ids.length} مشترك؟ سيُصفّر الدين نهائياً.`)) return;
    setBusy(true); setBanner("");
    let done = 0;
    for (const id of ids) {
      const res = await fetch(`/api/debts/${id}/clear`, { method: "POST" });
      if (res.ok) done++;
    }
    setBusy(false);
    setBanner(`تم مسح دين ${done} مشترك`);
    load();
  }

  const load = useCallback(() => {
    fetch("/api/debts").then((r) => {
      if (r.ok)
        r.json().then((d) => {
          setDebtors(d.debtors);
          setTotal(d.total);
          setChecked(new Set());
        });
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: number) => setChecked((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setChecked((s) => (s.size === debtors.length ? new Set() : new Set(debtors.map((d) => d.id))));

  function openPay(d: Debtor) {
    setPaying(d);
    setAmount(String(d.carry ?? ""));
    setError("");
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    setError("");
    if (!amount || Number(amount) <= 0) {
      setError("أدخل مبلغاً صحيحاً");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/debts/${paying.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل التسديد");
        return;
      }
      setPaying(null);
      load();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  // تسديد كامل الدين لكل المحدّدين
  async function paySelected() {
    const ids = [...checked];
    if (ids.length === 0) return;
    if (!window.confirm(`تسجيل تسديد كامل الدين لـ ${ids.length} مشترك؟`)) return;
    setBusy(true); setBanner("");
    let done = 0;
    for (const id of ids) {
      const d = debtors.find((x) => x.id === id);
      if (!d?.carry) continue;
      const res = await fetch(`/api/debts/${id}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: d.carry }),
      });
      if (res.ok) done++;
    }
    setBusy(false);
    setBanner(`تم تسجيل تسديد ${done} مشترك`);
    load();
  }

  // إرسال رسالة مطالبة بالدفع للمحدّدين (قالب الديون عبر واتساب)
  async function messageSelected() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true); setBanner("");
    // اجلب قالب الديون
    const tRes = await fetch("/api/sms-templates/bulk");
    const rows: { type: string; text: string }[] = tRes.ok ? await tRes.json() : [];
    const tpl = rows.find((r) => r.type === "debts")?.text?.trim();
    if (!tpl) {
      setBusy(false);
      setBanner("لا يوجد قالب لرسائل الديون — أضِفه من صفحة قوالب الرسائل");
      return;
    }
    const res = await fetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "WHATSAPP", text: tpl, target: "list", subscriberIds: ids }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      setBanner(`تم إرسال رسالة المطالبة — نجح ${d.sent} / فشل ${d.failed}`);
    } else {
      const d = await res.json().catch(() => ({}));
      setBanner(d.error ?? "تعذّر الإرسال");
    }
  }

  const allChecked = debtors.length > 0 && checked.size === debtors.length;

  return (
    <div className="p-6">
      <PageHeader title="ديون المشتركين" subtitle="المشتركون المدينون وتسديد الديون وإرسال المطالبات" />

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="inline-block rounded-xl border border-red-200 bg-red-50 px-6 py-4">
          <div className="text-sm text-slate-600">إجمالي الديون</div>
          <div className="text-3xl font-extrabold text-red-600">{fmt(total)} <span className="text-lg">د.ع</span></div>
          <div className="text-xs text-slate-500">عدد المدينين: {debtors.length}</div>
        </div>

        {/* شريط الإجراءات الجماعية */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">المحدّدون: {checked.size}</span>
          <button onClick={paySelected} disabled={busy || checked.size === 0} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">💵 تسديد المحدّدين</button>
          <button onClick={messageSelected} disabled={busy || checked.size === 0} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-40">💬 رسالة مطالبة للمحدّدين</button>
          {can("receipts.void") && (
            <button onClick={() => clearDebts([...checked])} disabled={busy || checked.size === 0} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">🗑 مسح ديون المحدّدين</button>
          )}
        </div>
      </div>

      {banner && <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{banner}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3"><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th className="p-3">#</th>
              <th className="p-3">المشترك</th>
              <th className="p-3">الهاتف</th>
              <th className="p-3">الدين</th>
              <th className="p-3">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {debtors.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">لا يوجد مدينون 🎉</td></tr>
            ) : (
              debtors.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3"><input type="checkbox" checked={checked.has(d.id)} onChange={() => toggle(d.id)} /></td>
                  <td className="p-3">{d.id}</td>
                  <td className="p-3 font-medium">{d.name}</td>
                  <td className="p-3">{d.phone ?? "—"}</td>
                  <td className="p-3 font-bold text-red-600">{fmt(d.carry)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openPay(d)}
                        className="rounded bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        💵 تسديد
                      </button>
                      {can("receipts.void") && (
                        <button
                          onClick={() => clearDebts([d.id])}
                          className="rounded bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                          title="مسح الدين (إسقاطه)"
                        >
                          🗑 مسح
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {paying && (
        <Modal title={`تسديد دين — ${paying.name}`} onClose={() => setPaying(null)}>
          <form onSubmit={pay} className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              الدين الحالي:{" "}
              <span className="font-bold text-red-600">{fmt(paying.carry)} د.ع</span>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ المسدّد</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
            </div>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPaying(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-slate-600 hover:bg-slate-200">إلغاء</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                {saving ? "جاري..." : "تسديد"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
