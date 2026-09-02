"use client";

// ⚙️ تحكّمُ المالك ببوّابة سوبر سيل وإعلانات التطبيق (طلبُ محمد 2026-08-29) — صفحةٌ جديدةٌ معزولة
// تحت حارس المالك (src/app/owner/layout.tsx). تقرأ/تكتب مخزَن appConfig عبر /api/owner/supercell،
// وهو نفسُ المخزَن الذي يقرؤه التطبيقُ (GET /api/app/config) وستحرّره صفحةُ الشركة لاحقاً.

import { useCallback, useEffect, useState } from "react";

type AnalyticsView = "tickets" | "field" | "both";
type State = { portalEnabled: boolean; analyticsView: AnalyticsView };

type CompanyUser = { id: number; username: string; password: string | null };

function Toggle({ on, onFlip, label, hint }: { on: boolean; onFlip: () => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={onFlip} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-right hover:bg-slate-50">
      <div>
        <div className="font-semibold text-slate-800">{label}</div>
        <div className="text-[11px] text-slate-500">{hint}</div>
      </div>
      <span className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "right-0.5" : "right-5"}`} />
      </span>
    </button>
  );
}

export default function OwnerSupercellPage() {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [nu, setNu] = useState({ username: "", password: "" });
  const [uErr, setUErr] = useState("");

  const load = useCallback(() => {
    fetch("/api/owner/supercell").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setS(d); });
  }, []);
  const loadUsers = useCallback(() => {
    fetch("/api/owner/supercell/users").then((r) => r.ok ? r.json() : []).then((d) => setUsers(Array.isArray(d) ? d : []));
  }, []);
  useEffect(() => { load(); loadUsers(); }, [load, loadUsers]);

  async function createUser() {
    setUErr("");
    const res = await fetch("/api/owner/supercell/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nu) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setUErr(d.error ?? "فشل الإنشاء"); return; }
    setNu({ username: "", password: "" }); loadUsers();
  }
  async function resetUser(id: number) {
    const p = prompt("كلمة المرور الجديدة (٤ أحرف فأكثر)")?.trim();
    if (!p) return;
    const res = await fetch(`/api/owner/supercell/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: p }) });
    if (res.ok) loadUsers(); else { const d = await res.json().catch(() => ({})); setUErr(d.error ?? "فشل التصفير"); }
  }
  async function deleteUser(id: number) {
    if (!confirm("حذفُ حساب الشركة هذا؟ (يُخرَج فوراً)")) return;
    const res = await fetch(`/api/owner/supercell/users/${id}`, { method: "DELETE" });
    if (res.ok) loadUsers();
  }

  if (!s) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  async function save() {
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/owner/supercell", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portalEnabled: s!.portalEnabled, analyticsView: s!.analyticsView }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error ?? "فشل الحفظ"); return; }
      setMsg("✓ حُفِظ — يظهرُ في التطبيق حيّاً");
      load();
    } catch { setMsg("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">🏢 إعدادات سوبر سيل</h1>
        <div className="flex gap-2">
          <a href="/owner/app-settings" className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-200">📱 إعدادات التطبيق</a>
          <a href="/owner" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">← رجوع</a>
        </div>
      </div>

      <Toggle on={s.portalEnabled} onFlip={() => setS({ ...s, portalEnabled: !s.portalEnabled })}
        label="تفعيل سوبر سيل" hint="مطفأ ⇒ صفحةُ /supercell مغلقةٌ (404)، وكلُّ ما يخصّ الشركة يختفي من تطبيق المشتركين" />

      {/* 📊 عرضُ «أداء الوكلاء» في البوّابة — يتحكّم المالكُ بما تراه الشركة */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">📊 قسم «أداء الوكلاء»</div>
        <div className="mb-3 text-[11px] text-slate-500">ما تراه الشركةُ في تبويب الأداء داخل البوّابة.</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {([
            { v: "tickets", t: "التذاكر + العدّادات", h: "تذاكرُ الشركة + كلّي/أكتف/متصل" },
            { v: "field", t: "أداء لوحة الفنيين", h: "المُنجَز والزمن والالتزام بالمهلة" },
            { v: "both", t: "الاثنان", h: "العرضان معاً" },
          ] as { v: AnalyticsView; t: string; h: string }[]).map((o) => (
            <button key={o.v} type="button" onClick={() => setS({ ...s, analyticsView: o.v })}
              className={`flex-1 rounded-xl border p-3 text-right transition ${s.analyticsView === o.v ? "border-mynet-blue bg-mynet-blue/10 ring-1 ring-mynet-blue" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
              <div className={`text-sm font-semibold ${s.analyticsView === o.v ? "text-mynet-blue" : "text-slate-700"}`}>{o.t}</div>
              <div className="text-[11px] text-slate-500">{o.h}</div>
            </button>
          ))}
        </div>
      </div>

      {/* حساباتُ الشركة — يُنشئها المالكُ يدويّاً حصراً (لا تسجيلَ ذاتيّ) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-800">حسابات دخول الشركة</div>
        <div className="mb-3 text-[11px] text-slate-500">تدخلُ بها الشركةُ بوّابةَ /supercell. تُنشأ هنا فقط — لا تسجيلَ ذاتيّ. الحذفُ أو التصفيرُ يُخرِج الحسابَ فوراً.</div>
        <div className="space-y-2">
          {users.length === 0 && <div className="text-xs text-slate-400">لا حسابات بعد.</div>}
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2 text-sm">
              <span className="font-bold text-slate-700" dir="ltr">{u.username}</span>
              <span className="text-slate-400" dir="ltr">{u.password ?? "—"}</span>
              <span className="flex-1" />
              <button type="button" onClick={() => resetUser(u.id)} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100">تصفير كلمة المرور</button>
              <button type="button" onClick={() => deleteUser(u.id)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">حذف</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} dir="ltr" placeholder="اسم المستخدم" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} dir="ltr" placeholder="كلمة المرور" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="button" onClick={createUser} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">+ إنشاء حساب</button>
          {uErr && <span className="text-xs text-red-500">{uErr}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">إعلاناتُ التطبيق انتقلت إلى «📱 إعدادات التطبيق».</div>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-mynet-blue px-6 py-2 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
      </div>
    </div>
  );
}
