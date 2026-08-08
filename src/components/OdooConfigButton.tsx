"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

// زرّ «ربط أودو» في ترويسة صفحة إدارة الفنيين — للمدير والمستخدم (لمكتبٍ محدَّد).
// شارةٌ ديناميّة (مفعّل أخضر / غير مفعّل أحمر تعكس آخر دخولٍ ناجح) + نافذة إعداد (يوزر/باسورد/اختبار/حفظ).
type OdooStatus = { odooEnabled: string; hasOdooCreds: boolean; odooUser: string | null; odooUrl: string | null; odooLastOk: string | null; odooLastError: string | null };

export default function OdooConfigButton({ officeId, officeName, onChange }: { officeId: number | null; officeName: string; onChange?: () => void }) {
  const [odoo, setOdoo] = useState<OdooStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ odooUser: "", odooPass: "", odooUrl: "" });
  const [enabledForm, setEnabledForm] = useState(true);
  const [test, setTest] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (officeId == null) { setOdoo(null); return; }
    fetch(`/api/towers/${officeId}/odoo`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !d.error) setOdoo(d); }).catch(() => {});
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  if (officeId == null) return null;
  const on = odoo?.odooEnabled === "1" && !!odoo?.odooLastOk;

  async function testOdoo() {
    if (officeId == null) return;
    setBusy(true); setTest("جارٍ الاختبار…");
    try {
      const r = await fetch(`/api/towers/${officeId}/odoo-test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      setTest(`${d.ok ? "✓" : "✗"} ${d.message ?? d.error ?? "تعذّر الاختبار"}`);
    } catch { setTest("✗ تعذّر الاتصال بالخادم"); }
    setBusy(false);
  }
  async function save() {
    if (officeId == null) return;
    setBusy(true); setTest("");
    try {
      const r = await fetch(`/api/towers/${officeId}/odoo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, odooEnabled: enabledForm ? "1" : "0" }) });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (r.ok) { load(); setOpen(false); onChange?.(); }
      else setTest(`✗ ${d.error ?? "تعذّر الحفظ"}`);
    } catch { setBusy(false); setTest("✗ تعذّر الاتصال بالخادم"); }
  }

  return (
    <>
      <button
        onClick={() => { setForm({ odooUser: odoo?.odooUser ?? "", odooPass: "", odooUrl: odoo?.odooUrl ?? "" }); setEnabledForm((odoo?.odooEnabled ?? "0") === "1"); setTest(""); setOpen(true); }}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold text-white shadow-sm active:scale-95"
        style={{ background: on ? "#16a34a" : "#dc2626" }}
        title={on ? "ربط أودو مفعّل — اضغط للإعداد" : "ربط أودو غير مفعّل — اضغط للإعداد"}
      >
        🔗 أودو · {on ? "مفعّل" : "غير مفعّل"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-center text-lg font-extrabold">🔗 ربط أودو — {officeName}</div>
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-2.5">
              <input type="checkbox" checked={enabledForm} onChange={(e) => setEnabledForm(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              <span className="text-sm font-bold text-slate-700">تفعيل ربط أودو لهذا المكتب</span>
            </label>
            <div className="space-y-2">
              <Field label="اسم المستخدم (أودو)">
                <input value={form.odooUser} onChange={(e) => setForm((f) => ({ ...f, odooUser: e.target.value }))} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
              </Field>
              <Field label={odoo?.hasOdooCreds ? "كلمة المرور (اتركها فارغة لإبقائها)" : "كلمة المرور"}>
                <input type="password" value={form.odooPass} onChange={(e) => setForm((f) => ({ ...f, odooPass: e.target.value }))} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
              </Field>
              <Field label="رابط أودو (اختياري)">
                <input value={form.odooUrl} onChange={(e) => setForm((f) => ({ ...f, odooUrl: e.target.value }))} dir="ltr" placeholder="https://odoo.supercell.iq" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
              </Field>
            </div>
            <button onClick={testOdoo} disabled={busy} className="mt-3 w-full rounded-lg border border-blue-500 bg-blue-50 py-2 text-sm font-bold text-blue-600 hover:bg-blue-100 disabled:opacity-60">🔌 اختبار الاتصال</button>
            {test && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-700">{test}</div>}
            {!test && odoo?.odooLastError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">آخر خطأ: {odoo.odooLastError}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={busy} className="flex-1 rounded-lg bg-blue-600 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "..." : "حفظ"}</button>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-600">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (<label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>{children}</label>);
}
