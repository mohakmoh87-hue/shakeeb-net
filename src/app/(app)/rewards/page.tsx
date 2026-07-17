"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

type Log = {
  id: number; kind: string; amount: number; code: string | null; context: string | null;
  subscriberName: string | null; balanceAfter: number | null; createdByName: string | null; createdByUser: string | null; createdAt: string;
};
type Data = { logs: Log[]; totalGranted: number; totalRedeemed: number; outstanding: number };

const fmt = (n: number | null) => Number(n ?? 0).toLocaleString("en-US");
const CTX: Record<string, string> = { activation: "تفعيل", maintenance: "صيانة", sale: "بيع مخزن" };

export default function RewardsLogPage() {
  const [data, setData] = useState<Data | null>(null);
  const [kind, setKind] = useState<"" | "grant" | "redeem">("");
  const [denied, setDenied] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/rewards/log${kind ? `?kind=${kind}` : ""}`).then((r) => {
      if (r.status === 403) { setDenied(true); return; }
      if (r.ok) r.json().then(setData);
    });
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  if (denied) return <div className="p-6"><PageHeader title="سجلّ المكافآت" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">هذه الصفحة للمدير فقط.</div></div>;

  return (
    <div className="p-6">
      <PageHeader title="🎁 سجلّ المكافآت" subtitle="منح واستخدام أكواد مكافآت المشتركين" />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="إجمالي الممنوح" value={fmt(data?.totalGranted ?? 0)} color="text-emerald-700" bg="bg-emerald-50" />
        <Stat label="إجمالي المستخدَم" value={fmt(data?.totalRedeemed ?? 0)} color="text-fuchsia-700" bg="bg-fuchsia-50" />
        <Stat label="الأرصدة القائمة حالياً" value={fmt(data?.outstanding ?? 0)} color="text-amber-700" bg="bg-amber-50" />
      </div>

      <div className="mb-3 flex gap-2">
        {([["", "الكل"], ["grant", "منح"], ["redeem", "استخدام"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${kind === k ? "bg-fuchsia-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>{label}</button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th className="p-3">#</th><th className="p-3">النوع</th><th className="p-3">المشترك</th><th className="p-3">المبلغ</th><th className="p-3">الكود</th><th className="p-3">السياق</th><th className="p-3">الرصيد بعدها</th><th className="p-3">بواسطة</th><th className="p-3">التاريخ</th></tr>
          </thead>
          <tbody>
            {!data || data.logs.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400">لا سجلّات</td></tr>
            ) : data.logs.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="p-3">{l.id}</td>
                <td className="p-3">{l.kind === "grant" ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">منح</span> : <span className="rounded bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700">استخدام</span>}</td>
                <td className="p-3 font-medium">{l.subscriberName ?? "—"}</td>
                <td className={`p-3 font-bold ${l.kind === "grant" ? "text-emerald-700" : "text-fuchsia-700"}`}>{l.kind === "grant" ? "+" : "−"}{fmt(l.amount)}</td>
                <td className="p-3 font-mono" dir="ltr">{l.code ?? "—"}</td>
                <td className="p-3 text-slate-600">{l.context ? CTX[l.context] ?? l.context : "—"}</td>
                <td className="p-3">{fmt(l.balanceAfter)}</td>
                <td className="p-3 text-slate-500">{l.createdByName ?? l.createdByUser ?? "—"}</td>
                <td className="p-3 text-slate-500" dir="ltr">{formatDateTime(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 ${bg} p-5 shadow-sm`}>
      <div className="text-sm text-slate-600">{label}</div>
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">د.ع</div>
    </div>
  );
}
