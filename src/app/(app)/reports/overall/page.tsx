"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { formatDate } from "@/lib/format";

type Overall = {
  subscribers: { total: number; active: number; expired: number; inactive: number };
  period: { from: string; to: string; activated: number };
  packages: number;
  towers: number;
  cash: { totalIn: number; totalOut: number; balance: number };
  debts: { total: number; count: number };
  invoices: { count: number; total: number };
  activations: { count: number; total: number; collected: number };
  messagesSent: number;
};
type NotActSub = { id: number; name: string | null; phone: string | null; netUser: string | null; dateTo: string | null };

const fmt = (n: number) => Number(n).toLocaleString("en-US");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (d: string | null) => formatDate(d);

export default function OverallReport() {
  const firstOfMonth = new Date(new Date().setDate(1));
  const [from, setFrom] = useState(iso(firstOfMonth));
  const [to, setTo] = useState(iso(new Date()));
  const [d, setD] = useState<Overall | null>(null);

  // نافذة "لم يفعّلوا"
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NotActSub[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [channel, setChannel] = useState<"SMS" | "WHATSAPP" | "TELEGRAM">("WHATSAPP");
  const [text, setText] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");

  const load = useCallback(() => {
    fetch(`/api/reports/overall?from=${from}&to=${to}`).then(
      (r) => void (r.ok && r.json().then(setD)),
    );
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const notActivated = d ? d.subscribers.total - d.period.activated : 0;

  function openList() {
    setOpen(true); setResult(""); setChecked(new Set()); setLoadingList(true);
    fetch(`/api/reports/not-activated?from=${from}&to=${to}`).then((r) => {
      if (r.ok) r.json().then((data) => setList(data.subscribers));
    }).finally(() => setLoadingList(false));
  }
  function toggle(id: number) {
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setChecked((s) => (s.size === list.length ? new Set() : new Set(list.map((x) => x.id))));
  }
  async function send() {
    setResult("");
    if (checked.size === 0) { setResult("حدّد مشتركاً واحداً على الأقل"); return; }
    if (!text.trim()) { setResult("اكتب نص الرسالة"); return; }
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, text, target: "list", subscriberIds: [...checked] }),
      });
      const data = await res.json();
      setResult(res.ok ? `تم الإرسال إلى ${data.sent} مشترك (فشل ${data.failed})` : (data.error ?? "فشل الإرسال"));
    } catch { setResult("تعذّر الاتصال بالخادم"); }
    finally { setSending(false); }
  }

  return (
    <div className="p-6">
      <PageHeader title="التقرير الاجمالي" subtitle="نظرة شاملة على النظام" action={<PrintButton />} />

      {!d ? <div className="text-slate-400">جاري التحميل...</div> : (
        <>
          {/* المشتركون الذين لم يفعّلوا خلال مدة */}
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-bold text-slate-800">المشتركون الذين لم يفعّلوا اشتراكهم خلال مدة</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">من</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">إلى</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
              </div>
              <button onClick={openList} className="rounded-xl border border-red-200 bg-red-50 px-6 py-3 text-center transition hover:bg-red-100">
                <div className="text-sm text-slate-600">لم يفعّلوا خلال المدة (اضغط للعرض)</div>
                <div className="text-3xl font-extrabold text-red-600">{fmt(notActivated)}</div>
                <div className="text-xs text-slate-500">مشترك — اضغط لإرسال رسالة لهم</div>
              </button>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-3 text-center">
                <div className="text-sm text-slate-600">فعّلوا خلال المدة</div>
                <div className="text-3xl font-extrabold text-emerald-600">{fmt(d.period.activated)}</div>
              </div>
            </div>
          </div>

          {/* البطاقات */}
          <div className="print-area grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Card label="إجمالي المشتركين" value={fmt(d.subscribers.total)} />
            <Card label="اشتراكات نشطة (مفعّلة)" value={fmt(d.subscribers.active)} color="text-emerald-600" bg="bg-emerald-50" />
            <Card label="المشتركون غير المفعّلين" value={fmt(d.subscribers.inactive)} color="text-red-600" bg="bg-red-50" />
            <Card label="رصيد الصندوق" value={fmt(d.cash.balance)} color="text-mynet-blue" bg="bg-blue-50" />
            <Card label="إجمالي الديون" value={fmt(d.debts.total)} color="text-amber-600" />
            <Card label="عدد المدينين" value={fmt(d.debts.count)} />
            <Card label="إجمالي القبض" value={fmt(d.cash.totalIn)} color="text-emerald-600" />
            <Card label="إجمالي الصرف" value={fmt(d.cash.totalOut)} color="text-red-600" />
            <Card label="الباقات" value={fmt(d.packages)} />
            <Card label="المكاتب" value={fmt(d.towers)} />
            <Card label="عدد الفواتير" value={fmt(d.invoices.count)} />
            <Card label="مبيعات الفواتير" value={fmt(d.invoices.total)} color="text-mynet-blue" />
            <Card label="عمليات التفعيل (الكل)" value={fmt(d.activations.count)} />
            <Card label="قيمة التفعيلات" value={fmt(d.activations.total)} color="text-mynet-blue" />
            <Card label="رسائل مُرسلة" value={fmt(d.messagesSent)} />
          </div>
        </>
      )}

      {/* نافذة قائمة غير المفعّلين + إرسال رسالة */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={() => setOpen(false)}>
          <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
              <h3 className="font-bold text-slate-800">المشتركون الذين لم يفعّلوا ({list.length})</h3>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
              {/* القائمة */}
              <div className="flex-1 overflow-auto border-b border-slate-200 md:border-b-0 md:border-l">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-600">
                    <tr>
                      <th className="p-2"><input type="checkbox" checked={list.length > 0 && checked.size === list.length} onChange={toggleAll} /></th>
                      <th className="p-2">الاسم</th><th className="p-2">اليوزر</th><th className="p-2">الهاتف</th><th className="p-2">ينتهي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingList ? (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">جاري التحميل...</td></tr>
                    ) : list.length === 0 ? (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">لا يوجد</td></tr>
                    ) : list.map((s) => (
                      <tr key={s.id} className={`border-t border-slate-100 ${checked.has(s.id) ? "bg-blue-50" : ""}`}>
                        <td className="p-2"><input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} /></td>
                        <td className="p-2 font-medium">{s.name}</td>
                        <td className="p-2" dir="ltr">{s.netUser ?? "—"}</td>
                        <td className="p-2" dir="ltr">{s.phone ?? "—"}</td>
                        <td className="p-2" dir="ltr">{fmtDate(s.dateTo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* إرسال الرسالة */}
              <div className="w-full shrink-0 space-y-3 p-4 md:w-[300px] md:overflow-y-auto">
                <div className="text-sm font-semibold text-slate-700">المحدّدون: <span className="text-mynet-blue">{checked.size}</span></div>
                <div className="flex gap-1">
                  {(["SMS", "WHATSAPP", "TELEGRAM"] as const).map((c) => (
                    <button key={c} onClick={() => setChannel(c)} className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${channel === c ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600"}`}>
                      {c === "SMS" ? "SMS" : c === "WHATSAPP" ? "واتساب" : "تيليغرام"}
                    </button>
                  ))}
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="اكتب نص الرسالة... يمكنك استخدام {name} {dateTo} {carry} {office}" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                {result && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{result}</div>}
                <button onClick={send} disabled={sending} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {sending ? "جاري الإرسال..." : `إرسال إلى ${checked.size} مشترك 📤`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color, bg }: { label: string; value: string; color?: string; bg?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 ${bg ?? "bg-white"} p-4 shadow-sm`}>
      <div className="text-sm text-slate-600">{label}</div>
      <div className={`text-2xl font-extrabold ${color ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
}
