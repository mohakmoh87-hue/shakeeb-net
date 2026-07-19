"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import PageHeader from "./PageHeader";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "password" | "select" | "textarea" | "checkbox";
  required?: boolean;
  options?: { value: string | number; label: string }[];
  placeholder?: string;
};

export type Column<T> = {
  header: string;
  render: (row: T) => React.ReactNode;
  // عند توفيره يصبح رأس العمود قابلاً للنقر للفرز تصاعدي/تنازلي على هذه القيمة
  sortValue?: (row: T) => string | number | boolean | null | undefined;
};

type Row = { id: number } & Record<string, unknown>;

export default function CrudManager<T extends Row>({
  title,
  subtitle,
  apiBase,
  columns,
  fields,
  searchable = false,
  addLabel = "إضافة",
  rowActions,
  headerExtra,
  selectable = false,
  onBulkDelete,
  onDeleteAll,
}: {
  title: string;
  subtitle?: string;
  apiBase: string;
  columns: Column<T>[];
  fields: Field[];
  searchable?: boolean;
  addLabel?: string;
  rowActions?: (row: T) => React.ReactNode;
  headerExtra?: React.ReactNode;
  selectable?: boolean;
  onBulkDelete?: (ids: number[]) => Promise<void>;
  onDeleteAll?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sort, setSort] = useState<{ i: number; dir: "asc" | "desc" } | null>(null);

  // ترتيب الصفوف حسب العمود المختار (تصاعدي/تنازلي) — القيم الفارغة تبقى في الأسفل دائماً
  const col = sort ? columns[sort.i] : null;
  const sortedRows = col?.sortValue
    ? [...rows].sort((a, b) => {
        const va = col.sortValue!(a);
        const vb = col.sortValue!(b);
        const dir = sort!.dir === "asc" ? 1 : -1;
        const ea = va === null || va === undefined || va === "";
        const eb = vb === null || vb === undefined || vb === "";
        if (ea && eb) return 0;
        if (ea) return 1; // الفارغ أسفلاً
        if (eb) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb), "ar", { numeric: true }) * dir;
      })
    : rows;

  function toggleSort(i: number) {
    setSort((s) => (s && s.i === i ? { i, dir: s.dir === "asc" ? "desc" : "asc" } : { i, dir: "asc" }));
  }

  function toggleSel(id: number) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }
  async function bulkDelete() {
    if (!onBulkDelete || selected.size === 0) return;
    if (!confirm(`حذف ${selected.size} مشترك محدّد؟`)) return;
    setBulkBusy(true);
    try { await onBulkDelete([...selected]); setSelected(new Set()); await load(query); }
    finally { setBulkBusy(false); }
  }
  async function deleteAll() {
    if (!onDeleteAll) return;
    if (!confirm("⚠️ حذف جميع المشتركين نهائياً من القائمة؟ لا يمكن التراجع بسهولة.")) return;
    if (!confirm("تأكيد أخير: حذف الكل؟")) return;
    setBulkBusy(true);
    try { await onDeleteAll(); setSelected(new Set()); await load(query); }
    finally { setBulkBusy(false); }
  }

  const load = useCallback(
    async (q = "") => {
      setLoading(true);
      const url = searchable
        ? `${apiBase}?q=${encodeURIComponent(q)}`
        : apiBase;
      const res = await fetch(url);
      if (res.ok) setRows(await res.json());
      setLoading(false);
    },
    [apiBase, searchable],
  );

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({});
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: T) {
    setEditing(row);
    const f: Record<string, string> = {};
    for (const field of fields) {
      const v = row[field.name];
      if (field.type === "checkbox") f[field.name] = v ? "1" : "0";
      else f[field.name] = v === null || v === undefined ? "" : String(v);
    }
    setForm(f);
    setError("");
    setModalOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const raw = form[field.name] ?? "";
        if (field.type === "checkbox") payload[field.name] = raw === "1" ? "1" : "0";
        else payload[field.name] = raw === "" ? null : raw;
      }
      const res = await fetch(
        editing ? `${apiBase}/${editing.id}` : apiBase,
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الحفظ");
        return;
      }
      setModalOpen(false);
      await load(query);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: T) {
    if (!confirm("هل تريد حذف هذا السجل؟")) return;
    const res = await fetch(`${apiBase}/${row.id}`, { method: "DELETE" });
    if (res.ok) await load(query);
  }

  return (
    <div className="p-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex gap-2">
            {headerExtra}
            <button
              onClick={openAdd}
              className="rounded-lg bg-mynet-blue px-4 py-2 font-semibold text-white shadow transition hover:bg-mynet-blue-dark"
            >
              + {addLabel}
            </button>
          </div>
        }
      />

      {searchable && (
        <div className="mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(query)}
            placeholder="ابحث بالاسم أو الهاتف أو العنوان... ثم Enter"
            className="w-full max-w-md rounded-lg border border-slate-300 px-4 py-2 outline-none focus:border-mynet-blue focus:ring-2 focus:ring-blue-100"
          />
        </div>
      )}

      {selectable && (onBulkDelete || onDeleteAll) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {onBulkDelete && (
            <button
              onClick={bulkDelete}
              disabled={bulkBusy || selected.size === 0}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700 disabled:opacity-40"
            >
              🗑️ حذف المحدّد ({selected.size})
            </button>
          )}
          {onDeleteAll && (
            <button
              onClick={deleteAll}
              disabled={bulkBusy}
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
            >
              حذف جميع المشتركين
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-sm text-slate-500 hover:underline">
              إلغاء التحديد
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {selectable && (
                <th className="p-3">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c, i) => (
                <th key={i} className="p-3 font-semibold">
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(i)}
                      className="flex items-center gap-1 font-semibold transition hover:text-mynet-blue"
                      title="اضغط للترتيب تصاعدي/تنازلي"
                    >
                      {c.header}
                      <span className={`text-[11px] ${sort?.i === i ? "text-mynet-blue" : "text-slate-300"}`}>
                        {sort?.i === i ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              <th className="p-3 font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 2 : 1)}
                  className="p-8 text-center text-slate-400"
                >
                  جاري التحميل...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 2 : 1)}
                  className="p-8 text-center text-slate-400"
                >
                  لا توجد سجلات
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${selected.has(row.id) ? "bg-blue-50" : ""}`}
                >
                  {selectable && (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSel(row.id)}
                      />
                    </td>
                  )}
                  {columns.map((c, i) => (
                    <td key={i} className="p-3 text-slate-700">
                      {c.render(row)}
                    </td>
                  ))}
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {rowActions?.(row)}
                      <button
                        onClick={() => openEdit(row)}
                        className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
                      >
                        تعديل
                      </button>
                      <button
                        onClick={() => remove(row)}
                        className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-sm text-slate-500">
        العدد: {rows.length}
      </div>

      {modalOpen && (
        <Modal
          title={editing ? "تعديل" : addLabel}
          onClose={() => setModalOpen(false)}
        >
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.name}
                  className={field.type === "textarea" ? "sm:col-span-2" : ""}
                >
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {field.label}
                    {field.required && (
                      <span className="text-red-500"> *</span>
                    )}
                  </label>
                  {field.type === "checkbox" ? (
                    <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={form[field.name] === "1"}
                        onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.checked ? "1" : "0" }))}
                        className="h-4 w-4 accent-emerald-600"
                      />
                      {field.placeholder ?? "نعم"}
                    </label>
                  ) : field.type === "select" ? (
                    <select
                      value={form[field.name] ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [field.name]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
                    >
                      <option value="">— اختر —</option>
                      {field.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      value={form[field.name] ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [field.name]: e.target.value }))
                      }
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : field.type === "password" ? "text" : "text"}
                      value={form[field.name] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [field.name]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
                    />
                  )}
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-slate-600 hover:bg-slate-200"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-mynet-blue px-5 py-2 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60"
              >
                {saving ? "جاري الحفظ..." : "حفظ"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
