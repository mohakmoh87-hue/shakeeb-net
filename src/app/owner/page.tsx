"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Agent = {
  id: number; name: string; officeCap: number; planExpiry: string | null;
  isTrial: boolean; officeCount: number; userCount: number; expired: boolean;
};

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "بلا انتهاء";

export default function OwnerPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  // نموذج إضافة وكيل
  const [f, setF] = useState({ name: "", officeCap: 1, planMonths: 0, managerFullName: "", managerUsername: "", managerPassword: "" });

  const load = useCallback(() => {
    fetch("/api/owner/agents").then((r) => r.ok ? r.json() : { agents: [] }).then((d) => { setAgents(d.agents ?? []); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addAgent() {
    setMsg("");
    const r = await fetch("/api/owner/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setAdding(false); setF({ name: "", officeCap: 1, planMonths: 0, managerFullName: "", managerUsername: "", managerPassword: "" }); load(); }
    else setMsg(d.error ?? "تعذّرت الإضافة");
  }
  async function patch(id: number, body: Record<string, unknown>) {
    const r = await fetch(`/api/owner/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) load(); else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر التعديل"); }
  }
  async function remove(a: Agent) {
    if (!confirm(`حذف الوكيل «${a.name}» نهائياً؟\nسيُمحى كل شيء: ${a.officeCount} مكتب، ${a.userCount} مستخدم، وكل المشتركين والحسابات والكروت. لا يمكن التراجع.`)) return;
    if (!confirm("تأكيد أخير: حذف نهائي لكل بيانات هذا الوكيل؟")) return;
    const r = await fetch(`/api/owner/agents/${a.id}`, { method: "DELETE" });
    if (r.ok) load(); else alert("تعذّر الحذف");
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800">👑 لوحة مالك النظام</h1>
        <div className="flex gap-2">
          <button onClick={() => setAdding(true)} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700">➕ وكيل جديد</button>
          <button onClick={logout} className="rounded-xl bg-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-300">خروج</button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-400">جاري التحميل…</div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">لا يوجد وكلاء بعد — أضف أول وكيل.</div>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => (
            <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-800">{a.name} {a.isTrial && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">تجريبي</span>}</div>
                  <div className="mt-1 text-xs text-slate-500">🏢 {a.officeCount}/{a.officeCap} مكتب · 👤 {a.userCount} مستخدم · 📅 ينتهي: <span className={a.expired ? "font-bold text-red-600" : "text-slate-600"}>{fmtDate(a.planExpiry)}{a.expired ? " (منتهٍ)" : ""}</span></div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-slate-600">سقف المكاتب
                    <input type="number" min={0} defaultValue={a.officeCap} onBlur={(e) => { const v = Number(e.target.value); if (v !== a.officeCap) patch(a.id, { officeCap: v }); }} className="w-16 rounded border border-slate-300 px-2 py-1 text-center" />
                  </label>
                  <button onClick={() => patch(a.id, { addMonths: 1 })} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">+شهر</button>
                  <button onClick={() => patch(a.id, { addMonths: 12 })} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">+سنة</button>
                  <button onClick={() => { const m = prompt("تمديد بعدد أشهر:"); if (m) patch(a.id, { addMonths: Number(m) }); }} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">تمديد…</button>
                  <button onClick={() => patch(a.id, { clearExpiry: true })} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">بلا انتهاء</button>
                  <button onClick={() => remove(a)} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">🗑 حذف</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdding(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-center text-lg font-bold text-slate-800">➕ وكيل جديد</h3>
            {msg && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-center text-sm text-red-600">{msg}</div>}
            <div className="space-y-2">
              <Field label="اسم الوكيل (العلامة)"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="inp" /></Field>
              <div className="flex gap-2">
                <Field label="سقف المكاتب"><input type="number" min={0} value={f.officeCap} onChange={(e) => setF({ ...f, officeCap: Number(e.target.value) })} className="inp" /></Field>
                <Field label="مدة الاشتراك (أشهر، 0=دائم)"><input type="number" min={0} value={f.planMonths} onChange={(e) => setF({ ...f, planMonths: Number(e.target.value) })} className="inp" /></Field>
              </div>
              <hr className="my-2" />
              <div className="text-xs font-semibold text-slate-500">حساب مدير الوكيل الأول</div>
              <Field label="الاسم الكامل"><input value={f.managerFullName} onChange={(e) => setF({ ...f, managerFullName: e.target.value })} className="inp" /></Field>
              <Field label="اسم المستخدم"><input dir="ltr" value={f.managerUsername} onChange={(e) => setF({ ...f, managerUsername: e.target.value })} className="inp" /></Field>
              <Field label="كلمة السر"><input dir="ltr" value={f.managerPassword} onChange={(e) => setF({ ...f, managerPassword: e.target.value })} className="inp" /></Field>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={addAgent} className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700">إنشاء</button>
              <button onClick={() => setAdding(false)} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        </div>
      )}
      <style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.4rem .6rem;font-size:.9rem}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-xs font-semibold text-slate-500">{label}</span>{children}</label>;
}
