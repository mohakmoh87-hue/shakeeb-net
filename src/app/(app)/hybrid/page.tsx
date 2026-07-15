"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

type Worker = {
  id: number; machineId: string; name: string | null; towerId: number | null;
  officeName: string | null; priority: number; approved: boolean; lastSeen: string; online: boolean; isLeader: boolean;
};

const fmtTime = (d: string) => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function HybridWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [denied, setDenied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [nameEdits, setNameEdits] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    fetch("/api/hybrid/workers").then((r) => {
      if (r.status === 403) { setDenied(true); setLoaded(true); return; }
      if (r.ok) r.json().then((d) => { setWorkers(d.workers ?? []); setLoaded(true); });
      else setLoaded(true);
    });
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);

  async function savePriority(w: Worker) {
    const val = Number(edits[w.id] ?? w.priority);
    if (!Number.isFinite(val)) return;
    const r = await fetch("/api/hybrid/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, priority: val }) });
    if (r.ok) { setEdits((e) => { const n = { ...e }; delete n[w.id]; return n; }); load(); }
  }
  async function saveName(w: Worker) {
    const val = (nameEdits[w.id] ?? w.name ?? "").trim();
    const r = await fetch("/api/hybrid/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, name: val }) });
    if (r.ok) { setNameEdits((e) => { const n = { ...e }; delete n[w.id]; return n; }); load(); }
  }
  async function setApproved(w: Worker, approved: boolean) {
    const r = await fetch("/api/hybrid/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, approved }) });
    if (r.ok) load();
  }
  async function remove(w: Worker) {
    if (!confirm(`حذف الحاسبة «${w.name ?? w.machineId}» نهائياً؟\nلن تعود جزءاً من النظام الهجين إلا إذا سُجّلت ووُوفق عليها من جديد.`)) return;
    const r = await fetch(`/api/hybrid/workers?id=${w.id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  if (!loaded) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (denied) return <div className="p-6"><PageHeader title="حواسيب النظام الهجين" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية.</div></div>;

  return (
    <div className="p-6">
      <PageHeader title="حواسيب النظام الهجين" subtitle="أولوية الحواسيب — الأصغر رقماً يصير مضيف واتساب لكل المكاتب" />

      <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-slate-600">
        الحاسبة صاحبة <b>أصغر رقم أولوية</b> بين المتصلة تصير <b>القائد</b> (تستضيف واتساب لكل المكاتب وتنفّذ الإرسال/المزامنة).
        إن انطفأت، تتولّى التالية تلقائياً. غيّر الأرقام لتحديد من تريده عميلاً أساسياً.
      </div>

      {workers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          لا توجد حواسيب مُسجَّلة بعد — ستظهر هنا تلقائياً فور تنصيب الوكيل على أي حاسبة مكتب.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">اسم الحاسبة</th><th className="p-3">المكتب</th><th className="p-3">الأولوية</th>
                <th className="p-3">الاعتماد</th><th className="p-3">الاتصال</th><th className="p-3">القائد</th>
                <th className="p-3">آخر ظهور</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <input value={nameEdits[w.id] ?? w.name ?? ""} placeholder={w.machineId.slice(0, 8)} onChange={(e) => setNameEdits((x) => ({ ...x, [w.id]: e.target.value }))} className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
                      {nameEdits[w.id] != null && nameEdits[w.id] !== (w.name ?? "") && (
                        <button onClick={() => saveName(w)} className="rounded bg-mynet-blue px-2 py-1 text-xs font-semibold text-white">حفظ</button>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-300" dir="ltr">{w.machineId.slice(0, 13)}…</div>
                  </td>
                  <td className="p-3 text-slate-500">{w.officeName ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <input type="number" value={edits[w.id] ?? String(w.priority)} onChange={(e) => setEdits((x) => ({ ...x, [w.id]: e.target.value }))} className="w-16 rounded border border-slate-300 px-2 py-1 text-center" />
                      {edits[w.id] != null && Number(edits[w.id]) !== w.priority && (
                        <button onClick={() => savePriority(w)} className="rounded bg-mynet-blue px-2 py-1 text-xs font-semibold text-white">حفظ</button>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    {w.approved
                      ? <button onClick={() => setApproved(w, false)} className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-200" title="اضغط للإيقاف">✅ معتمَدة</button>
                      : <button onClick={() => setApproved(w, true)} className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white hover:bg-amber-600">تفعيل</button>}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${w.online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      <span className={`h-2 w-2 rounded-full ${w.online ? "bg-emerald-500" : "bg-slate-400"}`} />
                      {w.online ? "متصلة" : "غير متصلة"}
                    </span>
                  </td>
                  <td className="p-3">{w.isLeader ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">👑 القائد</span> : "—"}</td>
                  <td className="p-3 text-slate-500" dir="ltr">{fmtTime(w.lastSeen)}</td>
                  <td className="p-3"><button onClick={() => remove(w)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
