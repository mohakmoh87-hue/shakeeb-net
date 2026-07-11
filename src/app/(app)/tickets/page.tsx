"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import { formatDate } from "@/lib/format";

type Lookup = { id: number; name: string | null };
type Ticket = {
  id: number;
  desc: string | null;
  typeName: string | null;
  priorityName: string | null;
  statusName: string | null;
  tower: string | null;
  note: string | null;
  createdByUser: string | null;
  date: string | null;
  isClosed: number | null;
};

const fmtDate = (d: string | null) => formatDate(d);

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const [lookups, setLookups] = useState<{ types: Lookup[]; priorities: Lookup[]; states: Lookup[] }>({
    types: [], priorities: [], states: [],
  });
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/tickets?status=${filter}`).then((r) => void (r.ok && r.json().then(setTickets)));
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/tickets/lookups").then((r) => void (r.ok && r.json().then(setLookups)));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          desc: form.desc,
          typeId: form.typeId || null,
          priorityId: form.priorityId || null,
          statusId: form.statusId || null,
          tower: form.tower || null,
          note: form.note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل الحفظ"); return; }
      setModal(false);
      setForm({});
      load();
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setSaving(false); }
  }

  async function toggleClose(t: Ticket) {
    await fetch(`/api/tickets/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ close: t.isClosed !== 1 }),
    });
    load();
  }

  async function remove(t: Ticket) {
    if (!confirm("حذف هذه التذكرة؟")) return;
    await fetch(`/api/tickets/${t.id}`, { method: "DELETE" });
    load();
  }

  const tabs: { key: typeof filter; label: string }[] = [
    { key: "open", label: "المفتوحة" },
    { key: "closed", label: "المغلقة" },
    { key: "all", label: "الكل" },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="التذاكر والدعم الفني"
        subtitle="تذاكر الصيانة والأعطال"
        action={
          <button onClick={() => { setForm({}); setError(""); setModal(true); }} className="rounded-lg bg-mynet-blue px-4 py-2 font-semibold text-white shadow hover:bg-mynet-blue-dark">
            + تذكرة جديدة
          </button>
        }
      />

      <div className="mb-4 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${filter === t.key ? "bg-mynet-blue text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3">#</th>
              <th className="p-3">المشكلة</th>
              <th className="p-3">النوع</th>
              <th className="p-3">الأولوية</th>
              <th className="p-3">القاطع</th>
              <th className="p-3">التاريخ</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-slate-400">لا توجد تذاكر</td></tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3">{t.id}</td>
                  <td className="p-3 font-medium">{t.desc}</td>
                  <td className="p-3">{t.typeName ?? "—"}</td>
                  <td className="p-3">{t.priorityName ?? "—"}</td>
                  <td className="p-3">{t.tower ?? "—"}</td>
                  <td className="p-3">{fmtDate(t.date)}</td>
                  <td className="p-3">
                    {t.isClosed === 1 ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">مغلقة</span>
                    ) : (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">مفتوحة</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => toggleClose(t)} className={`rounded px-2 py-1 text-xs ${t.isClosed === 1 ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                        {t.isClosed === 1 ? "إعادة فتح" : "إغلاق"}
                      </button>
                      <button onClick={() => remove(t)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">حذف</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title="تذكرة جديدة" onClose={() => setModal(false)}>
          <form onSubmit={create} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">وصف المشكلة <span className="text-red-500">*</span></label>
              <textarea
                value={form.desc ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="النوع" value={form.typeId} options={lookups.types} onChange={(v) => setForm((f) => ({ ...f, typeId: v }))} />
              <Select label="الأولوية" value={form.priorityId} options={lookups.priorities} onChange={(v) => setForm((f) => ({ ...f, priorityId: v }))} />
              <Select label="الحالة" value={form.statusId} options={lookups.states} onChange={(v) => setForm((f) => ({ ...f, statusId: v }))} />
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">القاطع / المكتب</label>
                <input value={form.tower ?? ""} onChange={(e) => setForm((f) => ({ ...f, tower: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ملاحظات</label>
              <input value={form.note ?? ""} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue" />
            </div>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg bg-slate-100 px-4 py-2 text-slate-600 hover:bg-slate-200">إلغاء</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-mynet-blue px-5 py-2 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">{saving ? "جاري..." : "حفظ"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value?: string; options: Lookup[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue">
        <option value="">— اختر —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
