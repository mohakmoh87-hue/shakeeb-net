"use client";

import { useCallback, useEffect, useState } from "react";
import AdsEditor, { type AppContentT } from "@/components/AdsEditor";

// لوحةُ الشركة — تحرّرُ **نفسَ** إعلانات المالك (مخزَن appConfig، آخرُ من يكتب يفوز)، وتُظهر واردَ
// الطلبات (يُوصَل في القطعة ٧). محروسةٌ في الخادم بجلسة الشركة (page.tsx).
export default function CompanyDashboard({ username }: { username: string }) {
  const [content, setContent] = useState<AppContentT | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/company/config").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setContent(d); });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!content) return;
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/company/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error ?? "فشل الحفظ"); return; }
      setMsg("✓ حُفِظ — يظهرُ في التطبيق حيّاً"); load();
    } catch { setMsg("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }
  async function logout() {
    await fetch("/api/company/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-lg">🏢</span>
          <div>
            <div className="text-sm font-bold text-slate-800">بوّابة سوبر سيل</div>
            <div className="text-[11px] text-slate-500" dir="ltr">{username}</div>
          </div>
        </div>
        <button onClick={logout} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">خروج</button>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-sky-800">
          مرحباً 👋 — تحرّرُ من هنا إعلاناتِ التطبيق وعروضَه، وتظهرُ حيّةً لكلّ المشتركين. (وهي نفسُها التي يديرها مالكُ النظام — آخرُ حفظٍ هو الظاهر.)
        </div>

        {/* واردُ طلبات المشتركين — يُوصَل في القطعة ٧ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-1 font-semibold text-slate-800">وارد طلبات المشتركين</div>
          <div className="text-xs text-slate-400">لا طلباتٍ بعد — يُفعَّل مع ربط توجيه الطلبات قريباً.</div>
        </div>

        <div className="text-sm font-semibold text-slate-700">إعلانات التطبيق</div>
        {content
          ? <AdsEditor content={content} onChange={setContent} />
          : <div className="p-6 text-slate-400">جاري التحميل...</div>}

        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
          <button onClick={save} disabled={saving || !content}
            className="rounded-lg bg-slate-900 px-6 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </main>
    </div>
  );
}
