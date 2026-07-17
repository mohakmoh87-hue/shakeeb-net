"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { prepareSasEmbed } from "@/lib/sasEmbed";
import { localSasBase } from "@/lib/localSas";

type Tower = { id: number; name: string | null; loginUrl: string | null; username: string | null };
type SasUser = {
  sasId: number;
  username: string;
  name: string | null;
  phone: string | null;
  days: number;
  expiration: string | null;
  packageName: string | null;
  enabled: boolean;
  alreadyImported: boolean;
};

function sasDirectPanelUrl(loginUrl: string | null): string | null {
  if (!loginUrl) return null;
  const host = loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return `https://${host}/#/users/index`;
}

export default function Sas4ImportPage() {
  const router = useRouter();
  const [towers, setTowers] = useState<Tower[]>([]);
  const [towerId, setTowerId] = useState<number | "">("");
  const [users, setUsers] = useState<SasUser[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  // تبديل يدوي: تحميل SAS من حاسبة المكتب (العامل المحلي) — أسرع بكثير. يُحفَظ الاختيار.
  const [useLocal, setUseLocal] = useState(false);
  const localBase = useLocal ? "http://127.0.0.1:47615" : "";

  useEffect(() => {
    fetch("/api/towers").then((r) => { if (r.ok) r.json().then(setTowers); });
    // تفعيل تلقائي إن كُشِف العامل المحلي، أو استعادة اختيار المستخدم المحفوظ
    const saved = typeof window !== "undefined" ? localStorage.getItem("sas_use_local") : null;
    if (saved === "1") setUseLocal(true);
    else if (saved !== "0") localSasBase().then((b) => { if (b) setUseLocal(true); });
  }, []);

  function toggleLocal(v: boolean) {
    setUseLocal(v);
    try { localStorage.setItem("sas_use_local", v ? "1" : "0"); } catch { /* */ }
  }

  const tower = towers.find((t) => t.id === towerId);
  const directPanelUrl = sasDirectPanelUrl(tower?.loginUrl ?? null);

  // تسجيل دخول تلقائي وتحميل لوحة SAS4 المضمّنة عند اختيار المكتب
  useEffect(() => {
    setFrameUrl(null); setUsers([]); setSelected(new Set());
    if (!towerId) return;
    let active = true;
    // العامل المحلي: يحقن التوكن في اللوحة تلقائياً، فنحمّلها منه مباشرةً (سريع)
    if (localBase) {
      setFrameUrl(`${localBase}/sas/${towerId}#/users/index`);
    } else {
      prepareSasEmbed(Number(towerId)).then((ok) => {
        if (active) setFrameUrl(ok ? `/sas/${towerId}#/users/index` : directPanelUrl);
      });
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [towerId, localBase]);

  // سحب المشتركين المعروضين حالياً في اللوحة
  async function showCurrent() {
    setError(""); setResult(""); setLoading(true);
    try {
      // العامل المحلي (سريع) إن وُجد، وإلا Vercel
      const res = localBase
        ? await fetch(`${localBase}/sas4/last-view?towerId=${towerId}`)
        : await fetch("/api/sas4/last-view");
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "تعذّر قراءة العرض"); return; }
      setUsers(data.users);
      setSelected(new Set());
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setLoading(false); }
  }

  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const newCount = users.filter((u) => !u.alreadyImported).length;

  async function doImport() {
    setError(""); setResult("");
    const chosen = users.filter((u) => selected.has(u.sasId));
    if (chosen.length === 0) { setError("لم تحدّد أي مشترك"); return; }
    setImporting(true);
    try {
      const res = await fetch("/api/sas4/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ towerId, users: chosen }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل الاستيراد"); return; }
      setResult(`تم استيراد ${data.created} مشترك (تخطّي ${data.skipped} مكرّر)`);
      const importedIds = new Set(chosen.map((u) => u.sasId));
      setUsers((list) => list.map((u) => (importedIds.has(u.sasId) ? { ...u, alreadyImported: true } : u)));
      setSelected(new Set());
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setImporting(false); }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="استيراد من SAS4"
        subtitle="تصفّح صفحة المشتركين في اللوحة، ثم اضغط «عرض المعروض» لسحب ما هو أمامك"
        action={
          <button onClick={() => router.push("/subscribers")} className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-300">← رجوع</button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">المكتب (حساب SAS4)</label>
          <select value={towerId} onChange={(e) => setTowerId(Number(e.target.value) || "")} className="w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="">— اختر المكتب —</option>
            {towers.filter((t) => t.loginUrl && t.username).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={showCurrent} disabled={loading || !towerId} className="rounded-lg bg-mynet-blue px-5 py-2 font-semibold text-white shadow hover:bg-mynet-blue-dark disabled:opacity-60">
          {loading ? "..." : "⬇️ عرض المشتركين المعروضين في اللوحة"}
        </button>
        {/* تحميل SAS من حاسبة المكتب (أسرع) — يبقى الإطار مصغّراً في مكانه */}
        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${useLocal ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600"}`}>
          <input type="checkbox" checked={useLocal} onChange={(e) => toggleLocal(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          ⚡ حاسبة المكتب (أسرع)
        </label>
      </div>

      <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        💡 في لوحة SAS4 بالأسفل: تنقّل للصفحة/العدد الذي تريده (10 أو 50 أو 500...) أو ابحث، وعندما يظهر المشتركون أمامك اضغط «عرض المشتركين المعروضين».
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {result && <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ {result}</div>}

      {/* لوحة SAS4 المضمّنة */}
      {towerId !== "" && (
        <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between bg-slate-100 px-3 py-2 text-sm">
            <span className="font-semibold text-slate-700">لوحة SAS4 (تنقّل هنا كما تريد)</span>
            {directPanelUrl && <a href={directPanelUrl} target="_blank" rel="noopener noreferrer" className="text-mynet-blue hover:underline">فتح بنافذة جديدة ↗</a>}
          </div>
          {frameUrl ? (
            <iframe
              src={frameUrl}
              className="h-[520px] w-full border-0"
              title="SAS4"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
            />
          ) : (
            <div className="flex h-[120px] items-center justify-center text-sm text-slate-400">جاري تسجيل الدخول التلقائي...</div>
          )}
        </div>
      )}

      {/* المشتركون المعروضون */}
      {users.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">معروض {users.length} — جديد {newCount} — محدّد {selected.size}</span>
            <button onClick={() => setSelected(new Set(users.filter((u) => !u.alreadyImported).map((u) => u.sasId)))} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">تحديد الكل</button>
            <button onClick={() => setSelected(new Set())} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">إلغاء</button>
            <button onClick={doImport} disabled={importing} className="mr-auto rounded-lg bg-emerald-600 px-5 py-2 font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-60">
              {importing ? "جاري الاستيراد..." : `استيراد ${selected.size} مشترك`}
            </button>
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-right text-sm">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2"></th><th className="p-2">الاسم</th><th className="p-2">اليوزر</th>
                  <th className="p-2">الهاتف</th><th className="p-2">الباقة</th><th className="p-2">أيام</th><th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.sasId} className={`border-t border-slate-100 ${u.alreadyImported ? "opacity-50" : ""}`}>
                    <td className="p-2"><input type="checkbox" checked={selected.has(u.sasId)} onChange={() => toggle(u.sasId)} disabled={u.alreadyImported} /></td>
                    <td className="p-2 font-medium">{u.name ?? "—"}</td>
                    <td className="p-2 text-slate-500" dir="ltr">{u.username}</td>
                    <td className="p-2" dir="ltr">{u.phone ?? "—"}</td>
                    <td className="p-2">{u.packageName ?? "—"}</td>
                    <td className="p-2"><span className={u.days < 0 ? "text-red-600" : "text-emerald-600"}>{u.days}</span></td>
                    <td className="p-2">
                      {u.alreadyImported ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">مستورد</span>
                        : u.enabled ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">فعّال</span>
                        : <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">موقوف</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
