"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { formatDate } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";

type Tx = {
  id: number;
  moneyIn: number | null;
  moneyOut: number | null;
  accountName: string | null;
  notes: string | null;
  date: string | null;
  sourceType: string | null;
};
type Account = { id: number; name: string | null };

const fmt = (n: number | null | undefined) =>
  n == null ? "0" : Number(n).toLocaleString("en-US");
const fmtDate = (d: string | null) => formatDate(d);

export default function CashboxPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [summary, setSummary] = useState({ totalIn: 0, totalOut: 0, balance: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [type, setType] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { can } = usePermission();

  const load = useCallback(() => {
    fetch("/api/money").then((r) => {
      if (r.ok)
        r.json().then((d) => {
          setTxs(d.transactions);
          setSummary(d.summary);
        });
    });
  }, []);

  useEffect(() => {
    load();
    fetch("/api/accounts").then((r) => void (r.ok && r.json().then(setAccounts)));
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!amount || Number(amount) <= 0) {
      setError("أدخل مبلغاً صحيحاً");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount: Number(amount),
          accountId: accountId || null,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الحفظ");
        return;
      }
      setAmount("");
      setNotes("");
      load();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  // حذف حركة مالية عكسياً
  async function voidTx(t: Tx) {
    const label = t.sourceType === "debt" ? "تسديد الدين (سيرجع ديناً على المشترك)" : "الحركة المالية";
    if (!window.confirm(`حذف ${label}؟ سيُلغى مبلغها من الصندوق.`)) return;
    const res = await fetch(`/api/money/${t.id}/void`, { method: "POST" });
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "تعذّر الحذف");
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="المصروفات والمقبوضات" subtitle="تسجيل الصرف والقبض اليدوي فقط (إيجار، كهرباء، ...) — لا تظهر هنا التفعيلات" />

      {/* بطاقات الرصيد */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="إجمالي القبض (يدوي)" value={fmt(summary.totalIn)} color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard label="إجمالي الصرف (يدوي)" value={fmt(summary.totalOut)} color="text-red-600" bg="bg-red-50" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        {/* نموذج قبض/صرف */}
        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-800">حركة جديدة</h3>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("in")}
              className={`rounded-lg py-2 font-semibold transition ${type === "in" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              قبض +
            </button>
            <button
              type="button"
              onClick={() => setType("out")}
              className={`rounded-lg py-2 font-semibold transition ${type === "out" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              صرف −
            </button>
          </div>

          <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ (د.ع)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />

          <label className="mb-1 block text-sm font-medium text-slate-700">الحساب</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value) || "")}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          >
            <option value="">— بدون حساب —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <label className="mb-1 block text-sm font-medium text-slate-700">ملاحظات</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />

          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={saving}
            className={`w-full rounded-lg py-3 font-bold text-white shadow disabled:opacity-60 ${type === "in" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
          >
            {saving ? "جاري الحفظ..." : type === "in" ? "تسجيل قبض" : "تسجيل صرف"}
          </button>
        </form>

        {/* سجل الحركات */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">قبض</th>
                <th className="p-3">صرف</th>
                <th className="p-3">الحساب</th>
                <th className="p-3">ملاحظات</th>
                {can("receipts.void") && <th className="p-3"></th>}
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr><td colSpan={can("receipts.void") ? 7 : 6} className="p-6 text-center text-slate-400">لا توجد حركات</td></tr>
              ) : (
                txs.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="p-3">{t.id}</td>
                    <td className="p-3">{fmtDate(t.date)}</td>
                    <td className="p-3 font-semibold text-emerald-600">{t.moneyIn ? fmt(t.moneyIn) : "—"}</td>
                    <td className="p-3 font-semibold text-red-600">{t.moneyOut ? fmt(t.moneyOut) : "—"}</td>
                    <td className="p-3">{t.accountName ?? "—"}</td>
                    <td className="p-3 text-slate-600">{t.notes ?? "—"}</td>
                    {can("receipts.void") && (
                      <td className="p-3">
                        <button onClick={() => voidTx(t)} className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100" title="حذف عكسي">🗑 حذف</button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, bg, big }: { label: string; value: string; color: string; bg: string; big?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 ${bg} p-5 shadow-sm`}>
      <div className="text-sm text-slate-600">{label}</div>
      <div className={`${big ? "text-3xl" : "text-2xl"} font-extrabold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">د.ع</div>
    </div>
  );
}
