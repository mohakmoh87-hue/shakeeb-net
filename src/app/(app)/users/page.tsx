"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import { PERMISSION_GROUPS, expandLegacyPermissions } from "@/lib/rbac";
import { usePermission } from "@/lib/usePermission";

type Tower = { id: number; name: string | null };
type User = {
  id: number;
  fullName: string;
  username: string;
  isAdmin: boolean;
  permissions: string | null;
  deniedPermissions?: string | null;
  separateAccount?: boolean;
  viewOnly?: boolean;
  viewAllOffices?: boolean;
  towerId: number | null;
  isActive: boolean;
};

type Form = {
  fullName: string; username: string; password: string;
  isAdmin: boolean; permissions: Set<string>; deniedPermissions: Set<string>; towerId: number | "";
  separateAccount: boolean;
  viewOnly: boolean; viewAllOffices: boolean;
  isActive: boolean;
};
const emptyForm = (): Form => ({
  fullName: "", username: "", password: "", isAdmin: false,
  permissions: new Set(), deniedPermissions: new Set(), towerId: "", separateAccount: false, isActive: true,
  viewOnly: false, viewAllOffices: false,
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

  // ═════ البند ١ · «هذا المكتبُ له مستخدمٌ سلفاً» (طلبُ محمد 2026-08-13) ═════
  // «عند اختيار مستخدمٍ ثانٍ لنفس المكتب يجب أن يظهر أنّ لهذا المكتب مستخدماً وهو
  //  مستخدم ١ أو أيُّ اسمٍ وضعه، ويُقبَل، لكن يظهر له مربّعٌ اسمُه حسابٌ منفصل».
  // 🔑 ويُحسَب من القائمة المحمَّلة سلفاً — بلا أيّ طلبٍ إضافيّ للخادم.
  //   و`editId` يُستثنى: تعديلُ مستخدمٍ لا يجعله «زميلَ نفسِه».
  const officeMates = form.towerId
    ? users.filter((u) => u.towerId === form.towerId && u.id !== editId && !u.isAdmin)
    : [];

  function openAdd() { setEditId(null); setForm(emptyForm()); setError(""); setModal(true); }
  function openEdit(u: User) {
    setEditId(u.id);
    setForm({
      fullName: u.fullName, username: u.username, password: "", isAdmin: u.isAdmin,
      // توسيع المفاتيح القديمة (offices.manage...) إلى الجديدة — أول حفظ يكتبها نظيفة
      permissions: new Set<string>(expandLegacyPermissions((u.permissions ?? "").split(",").filter(Boolean))),
      deniedPermissions: new Set<string>((u.deniedPermissions ?? "").split(",").filter(Boolean)),
      towerId: u.towerId ?? "", separateAccount: !!u.separateAccount, isActive: u.isActive,
      viewOnly: !!u.viewOnly, viewAllOffices: !!u.viewAllOffices,
    });
    setError(""); setModal(true);
  }
  function togglePerm(key: string) {
    setForm((f) => { const n = new Set(f.permissions); n.has(key) ? n.delete(key) : n.add(key); return { ...f, permissions: n }; });
  }
  /** مربّعاتُ **المنع** للمدير: صحٌّ = ممنوع. مستقلّةٌ عن `permissions` تماماً. */
  function toggleDenied(key: string) {
    setForm((f) => { const n = new Set(f.deniedPermissions); n.has(key) ? n.delete(key) : n.add(key); return { ...f, deniedPermissions: n }; });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      const payload = {
        fullName: form.fullName, username: form.username, password: form.password || undefined,
        isAdmin: form.isAdmin, permissions: [...form.permissions],
        // المنعُ يُرسَل للمدير حصراً — ومربّعاتُه لا تظهر لغيره فلا معنى لإرسالها
        deniedPermissions: form.isAdmin ? [...form.deniedPermissions] : [],
        towerId: form.towerId || null, isActive: form.isActive,
        // 👁️ نوعُ المشاهدة ونطاقُه — والخادمُ يُفرغ صلاحيّاتَه ويمنع الإدارةَ عنه مهما أُرسل
        viewOnly: form.viewOnly, viewAllOffices: form.viewOnly ? form.viewAllOffices : false,
        // البند ١ · لا معنى للفصل بلا مكتب (مَن بلا مكتبٍ يرى كلَّ مكاتب وكيله)
        separateAccount: form.towerId ? form.separateAccount : false,
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
    // 🔴 عالٍ · كان الخطأُ يُبتلَع (لا else): مديرٌ يضغط حذفَ حسابه هو فيردّ الخادمُ «لا يمكنك
    //   حذفُ حسابك الحالي» ولا تظهر — فيظنّ الزرَّ معطوباً. الآن: يُعرَض سببُ الرفض.
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); setError(d.error ?? "تعذّر حذفُ المستخدم"); }
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
                <td className="p-3">{u.isAdmin
                  ? <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">مدير</span>
                  : u.viewOnly
                    ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700" title={u.viewAllOffices ? "يشاهد مشتركي كلّ المكاتب" : "يشاهد مشتركي مكتبه وحدَه"}>👁️ مشاهدة فقط{u.viewAllOffices ? " · كلُّ المكاتب" : ""}</span>
                    : "مستخدم"}</td>
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

              {/* ═════ البند ١ · تنبيهُ «للمكتب مستخدمٌ سلفاً» + مربّعُ «حسابٌ منفصل» ═════
                  طلبُ محمد: «عند اختيار مستخدمٍ ثانٍ لنفس المكتب يظهر أنّ لهذا المكتب
                  مستخدماً وهو <اسمُه>، ويُقبَل، لكن يظهر مربّعٌ اسمُه حسابٌ منفصل.
                  إن وضعتُ صحّاً فحسابُه وتفعيلاتُه منفصلةٌ والتقريرُ اليوميُّ يختلف؛
                  وإن لم أضع صحّاً فالاثنان يفعلان بنفس التقرير».
                  ⚠️ والفصلُ كان **إجباريّاً** لكلّ مكتبٍ فيه مستخدمان — فصار اختياريّاً،
                  وردمُ الهجرة حفظ سلوكَ المكتب القائم (ams) حرفيّاً. */}
              {!form.isAdmin && !form.viewOnly && officeMates.length > 0 && (
                <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <div className="mb-1 text-[12px] font-bold text-amber-900">
                    ℹ️ لهذا المكتب مستخدمٌ سلفاً: {officeMates.map((u) => u.fullName || u.username).join(" · ")}
                  </div>
                  <label className="flex items-start gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" className="mt-0.5" checked={form.separateAccount}
                      onChange={(e) => setForm({ ...form, separateAccount: e.target.checked })} />
                    <span>
                      حساب منفصل
                      <span className="block text-[11px] font-normal leading-5 text-slate-500">
                        صحٌّ ⇒ حساباتُ <b>المكتب كلِّه منفصلة</b>: كلُّ مستخدمٍ فيه (حتى القدامى غيرُ
                        المؤشَّرين) يرى تقريرَه اليوميَّ وحدَه.
                        <br />
                        فارغٌ عند الجميع ⇒ الكلُّ على <b>تقريرٍ واحد</b>.
                        <br />
                        والمديرُ يرى الإجماليَّ في الحالتَين، ومع الفصل تظهر له تبويباتُ كلِّ المستخدمين.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAdmin} disabled={form.viewOnly}
                  onChange={(e) => setForm({ ...form, isAdmin: e.target.checked, viewOnly: e.target.checked ? false : form.viewOnly })} /> مدير كامل الصلاحيات</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> مفعّل</label>
              </div>

              {/* ═════ 👁️ نوعُ المشاهدة فقط (طلبُ محمد 2026-11-21) ═════
                  «مستخدمٌ للمشاهدة فقط: لا يظهر له أيُّ شيءٍ ولا الصفحةُ الرئيسيّة —
                   صفحةٌ واحدةٌ فيها المشتركون بلا هاتف، يبحث بالاسم أو اليوزر، ويرى
                   متصلاً أو غيرَ متصل، وزرُّ عمليّاتٍ يرفع له صيانةً أو تنصيباً أو غيرَه». */}
              {!form.isAdmin && (
                <div className="col-span-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
                  <label className="flex items-start gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" className="mt-0.5" checked={form.viewOnly}
                      onChange={(e) => setForm({ ...form, viewOnly: e.target.checked, permissions: new Set(), separateAccount: false })} />
                    <span>
                      👁️ مشاهدة فقط
                      <span className="block text-[11px] font-normal leading-5 text-slate-500">
                        لا يرى شيئاً من البرنامج — ولا الشاشةَ الرئيسيّة. صفحةٌ واحدةٌ فيها
                        المشتركون <b>بلا أرقام هواتف</b>، بحثٌ بالاسم أو اليوزر، وحالةُ
                        «متصل / غير متصل»، وزرُّ عمليّاتٍ يرفع بطاقةَ صيانةٍ أو تنصيبٍ أو أيَّ نوع.
                        <br />
                        و<b>بلا أيّ صلاحيّة</b> ولا رفعِ مبالغَ ولا اختيارِ فنيّ.
                      </span>
                    </span>
                  </label>
                  {form.viewOnly && (
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <div className="mb-1 text-[12px] font-bold text-slate-700">نطاقُ ما يشاهده</div>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="radio" name="viewScope" checked={!form.viewAllOffices}
                          onChange={() => setForm({ ...form, viewAllOffices: false })} />
                        مشتركو <b>مكتبه</b> وحدَه {form.towerId ? "" : <span className="text-[11px] font-bold text-red-600">— اختر المكتبَ أعلاه</span>}
                      </label>
                      <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                        <input type="radio" name="viewScope" checked={form.viewAllOffices}
                          onChange={() => setForm({ ...form, viewAllOffices: true })} />
                        مشتركو <b>كلِّ مكاتبي</b>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ═════ مديرٌ بصلاحيّاتٍ محدَّدة (طلبُ محمد 2026-08-13) ═════
                «مديرٌ يأخذ كلَّ ميزات المدير ويرى كلَّ المكاتب، ولكن أمنعُ عنه أيَّ صلاحيّةٍ
                 أريد — مثل حسابات المدير أو مسحِ وصولات».
                🔑 وهي **قائمةُ منعٍ لا سماح**: المربّعُ **مطفأٌ = مسموح** (وهو حالُ كلّ مديرٍ
                  قائمٍ فصفرُ أثرٍ عليه)، وصحٌّ = **ممنوع**. ولو كانت سماحاً لَسلبت أوّلُ
                  نشرةٍ كلَّ المدراء صلاحيّاتِهم. */}
            {form.isAdmin && (
              <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                <div className="mb-1 text-sm font-semibold text-rose-800">🚫 صلاحيّاتٌ تُمنَع عن هذا المدير</div>
                <div className="mb-2 text-[11px] leading-5 text-slate-500">
                  المديرُ يملك كلَّ شيءٍ ويرى كلَّ المكاتب. ضع صحّاً على ما تريد <b>منعَه</b> عنه.
                  {form.deniedPermissions.size > 0 && <> — ممنوعٌ الآن: <b>{form.deniedPermissions.size}</b></>}
                </div>
                <div className="max-h-[45vh] space-y-3 overflow-y-auto pl-1">
                  {PERMISSION_GROUPS.map((grp) => (
                    <div key={grp.title}>
                      <div className="mb-1 border-b border-rose-100 pb-0.5 text-[11px] font-bold text-rose-700">{grp.title}</div>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {grp.items.map((p) => (
                          <label key={p.key} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={form.deniedPermissions.has(p.key)} onChange={() => toggleDenied(p.key)} />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!form.isAdmin && !form.viewOnly && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-700">الصلاحيات</div>
                {/* مقسّمة إلى الأصناف الثمانية (طلب محمد) — كل مجموعة تحت عنوانها */}
                <div className="max-h-[45vh] space-y-3 overflow-y-auto pl-1">
                  {PERMISSION_GROUPS.map((grp) => (
                    <div key={grp.title}>
                      <div className="mb-1 border-b border-slate-100 pb-0.5 text-[11px] font-bold text-mynet-blue">{grp.title}</div>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {grp.items.map((p) => (
                          <label key={p.key} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={form.permissions.has(p.key)} onChange={() => togglePerm(p.key)} />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
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
