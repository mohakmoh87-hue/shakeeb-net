"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import BackupSection from "@/components/BackupSection";
import { usePermission } from "@/lib/usePermission";

export default function SettingsPage() {
  const { can, me } = usePermission();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // علامة الوكيل (الاسم الظاهر بكامل البرنامج)
  const [brand, setBrand] = useState("");
  const [brandSaving, setBrandSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => void (r.ok && r.json().then(setForm)));
    fetch("/api/agent").then((r) => r.ok ? r.json() : null).then((d) => { if (d?.name) setBrand(d.name); });
  }, []);

  async function saveBrand() {
    if (!brand.trim()) return;
    setBrandSaving(true);
    const r = await fetch("/api/agent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: brand.trim() }) });
    setBrandSaving(false);
    if (r.ok) window.location.reload(); // تحديث العلامة في الشريط العلوي فوراً
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("settings.manage")) {
    return <div className="p-6"><PageHeader title="الإعدادات" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية الوصول إلى إعدادات المكتب.</div></div>;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="p-6">
      <PageHeader title="الإعدادات العامة" subtitle="العملة ومواعيد التقارير — أما الواتساب وبيانات كل مكتب فمن صفحة المكاتب" />

      {/* علامة الوكيل — تظهر بأعلى الشاشة وفي كامل البرنامج */}
      <div className="mb-5 max-w-lg rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <label className="mb-1 block text-sm font-bold text-emerald-800">🏷️ اسم العلامة (يظهر بأعلى الشاشة وفي الوصولات)</label>
        <p className="mb-2 text-xs text-slate-500">مثال: «قرصان نت» — سيظهر في كل مكان بدل الاسم الحالي.</p>
        <div className="flex gap-2">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="اسم علامتك" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500" />
          <button onClick={saveBrand} disabled={brandSaving || !brand.trim()} className="rounded-lg bg-emerald-600 px-5 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {brandSaving ? "…" : "حفظ"}
          </button>
        </div>
      </div>

      {/* النسخ الاحتياطي والاسترجاع لكل وكيل */}
      <BackupSection />

      <form onSubmit={save} className="max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Field label="اسم النظام (الافتراضي في الوصولات)" value={form.office} onChange={(v) => set("office", v)} />
        <Field label="سعر صرف الدولار (دينار)" value={form.dollar} onChange={(v) => set("dollar", v)} type="number" />
        <Field label="رمز الدولة" value={form.country} onChange={(v) => set("country", v)} placeholder="964" />
        {/* وقت تذكير الانتهاء انتقل لصفحة المكاتب (لكل مكتب وقته بحسب وقت فتحه وتشغيل حاسبته) */}
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
          ⏰ وقت تذكير انتهاء الاشتراك صار <b>لكل مكتب على حدة</b> — اضبطه من صفحة <a href="/towers" className="font-bold underline">المكاتب</a> (حقل «وقت تذكير انتهاء الاشتراك») بحسب وقت فتح كل مكتب وتشغيل حاسبته.
        </div>
        <Field label="وقت إرسال تقرير المدير (يومياً)" value={form.reportTime || "23:55"} onChange={(v) => set("reportTime", v)} type="time" />
        <Field label="وقت إرسال النسخة الاحتياطية للإيميل (يومياً)" value={form.backupTime || "04:00"} onChange={(v) => set("backupTime", v)} type="time" />

        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700">
          ربط واتساب كل مكتب، وبيانات SAS، ورقم المدير، والإرسال الصامت — كلها من صفحة{" "}
          <Link href="/towers" className="font-bold underline">المكاتب</Link>.
        </div>

        {saved && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ تم الحفظ</div>}
        <button type="submit" disabled={saving} className="w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value?: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
      />
    </div>
  );
}
