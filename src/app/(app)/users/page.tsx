"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import { PERMISSION_LIST } from "@/lib/rbac";
import { usePermission } from "@/lib/usePermission";

type Tower = { id: number; name: string | null };
type User = {
  id: number;
  fullName: string;
  username: string;
  isAdmin: boolean;
  permissions: string | null;
  towerId: number | null;
  isActive: boolean;
};

type Form = {
  fullName: string; username: string; password: string;
  isAdmin: boolean; permissions: Set<string>; towerId: number | "";
  isActive: boolean;
};
const emptyForm = (): Form => ({
  fullName: "", username: "", password: "", isAdmin: false,
  permissions: new Set(), towerId: "", isActive: true,
});

export default function UsersPage() {
  const { can, me } = usePermission();
  const [users, setUsers] = useState<User[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch("/api/users").then((r) => { if (r.ok) r.json().then(setUsers); });
  }, []);
  useEffect(() => {
    load();
    fetch("/api/towers").then((r) => { if (r.ok) r.json().then(setTowers); });
  }, [load]);

  const towerName = (id: number | null) => towers.find((t) => t.id === id)?.name ?? "—";

  function openAdd() { setEditId(null); setForm(emptyForm()); setError(""); setModal(true); }
  function openEdit(u: User) {
    setEditId(u.id);
    setForm({
      fullName: u.fullName, username: u.username, password: "", isAdmin: u.isAdmin,
      permissions: new Set((u.permissions ?? "").split(",").filter(Boolean)),
      towerId: u.towerId ?? "", isActive: u.isActive,
    });
    setError(""); setModal(true);
  }
  function togglePerm(key: string) {
    setForm((f) => { const n = new Set(f.permissions); n.has(key) ? n.delete(key) : n.add(key); return { ...f, permissions: n }; });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      const payload = {
        fullName: form.fullName, username: form.username, password: form.password || undefined,
        isAdmin: form.isAdmin, permissions: [...form.permissions],
        towerId: form.towerId || null, isActive: form.isActive,
      };
      const res = await fetch(editId ? `/api/users/${editId}` : "/api/users", {
        method: editId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل الحفظ"); return; }
      setModal(false); load();
    } catch { setError("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }
  async function remove(u: User) {
    if (!confirm("حذف هذا المستخدم؟")) return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("users.manage")) {
    return <div className="p-6"><PageHeader title="المستخدمون" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إدارة المستخدمين.</div></div>;
  }

  return (
    <div className="p-6">
      <PageHeader title="المستخدمون" subtitle="الصلاحيات والمكاتب"
        action={<button onClick={openAdd} className="rounded-lg bg-mynet-blue px-4 py-2 font-semibold text-white shadow hover:bg-mynet-blue-dark">+ إضافة مستخدم</button>} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th className="p-3">#</th><th className="p-3">الاسم</th><th className="p-3">المستخدم</th><th className="p-3">النوع</th><th className="p-3">المكتب</th><th className="p-3">الحالة</th><th className="p-3">إجراءات</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3">{u.id}</td>
                <td className="p-3 font-medium">{u.fullName}</td>
                <td className="p-3" dir="ltr">{u.username}</td>
                <td className="p-3">{u.isAdmin ? <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">مدير</span> : "مستخدم"}</td>
                <td className="p-3">{towerName(u.towerId)}</td>
                <td className="p-3">{u.isActive ? <span className="text-emerald-600">مفعّل</span> : <span className="text-slate-400">موقوف</span>}</td>
                <td className="p-3"><div className="flex gap-2">
                  <button onClick={() => openEdit(u)} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100">تعديل</button>
                  <button onClick={() => remove(u)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">حذف</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={editId ? "تعديل مستخدم" : "إضافة مستخدم"} onClose={() => setModal(false)}>
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-sm font-medium text-slate-700">الاسم الكامل *</label>
                <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">اسم المستخدم *</label>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">كلمة السر {editId && "(فارغ = عدم التغيير)"}</label>
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2" /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">المكتب (المكتب)</label>
                <select value={form.towerId} onChange={(e) => setForm({ ...form, towerId: Number(e.target.value) || "" })} className="w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">— كل المكاتب —</option>
                  {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> مدير كامل الصلاحيات</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> مفعّل</label>
              </div>
            </div>

            {!form.isAdmin && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-700">الصلاحيات</div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {PERMISSION_LIST.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={form.permissions.has(p.key)} onChange={() => togglePerm(p.key)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg bg-slate-100 px-4 py-2 text-slate-600 hover:bg-slate-200">إلغاء</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-mynet-blue px-5 py-2 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">{saving ? "جاري الحفظ..." : "حفظ"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
