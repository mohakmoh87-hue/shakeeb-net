"use client";

import { useCallback, useEffect, useState } from "react";
import AdsEditor, { type AppContentT } from "@/components/AdsEditor";
import MarketModeration from "./MarketModeration";

type OtpWaInfo = { instanceId: string; tokenSet: boolean };
type State = AppContentT & { otpWa: OtpWaInfo };
type Counts = { totalAppUsers: number; active30: number; banned: number };
type Sub = { id: number; name: string | null; phone: string | null; appBanned: boolean; lastAppLoginAt: string | null; state: string; daysExpired: number };

const STATE_LABEL: Record<string, string> = { active: "فعّال", grace: "مهلة", expired: "منتهٍ" };

export default function AppAdminDashboard({ username }: { username: string }) {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("");
  // مشتركو التطبيق
  const [counts, setCounts] = useState<Counts | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);

  const loadConfig = useCallback(() => {
    fetch("/api/app-admin/config").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setS(d); setInstanceId(d.otpWa?.instanceId ?? ""); setToken(""); }
    });
  }, []);
  const loadSubs = useCallback((query: string, p: number) => {
    const u = new URL("/api/app-admin/subscribers", window.location.origin);
    if (query.trim()) u.searchParams.set("q", query.trim());
    u.searchParams.set("page", String(p));
    fetch(u.toString().replace(window.location.origin, "")).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setCounts(d.counts); setSubs(d.subscribers ?? []); setPages(d.pages ?? 0); setTotal(d.total ?? 0); setPage(d.page ?? 1); }
    });
  }, []);
  useEffect(() => { const t = setTimeout(() => { loadConfig(); loadSubs("", 1); }, 0); return () => clearTimeout(t); }, [loadConfig, loadSubs]);

  async function save() {
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/app-admin/config", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { ads: s!.ads, offers: s!.offers, quick: s!.quick }, otpWa: { instanceId, token } }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error ?? "فشل الحفظ"); return; }
      setMsg("✓ حُفِظ"); loadConfig();
    } catch { setMsg("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }

  async function test() {
    if (!testPhone.trim()) { setTestMsg("أدخِل رقمَ الاختبار"); return; }
    setTestMsg("جارٍ الإرسال...");
    try {
      const res = await fetch("/api/app-admin/otp-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: testPhone }) });
      const d = await res.json().catch(() => ({}));
      setTestMsg(res.ok && d.ok ? `وصلت رسالةُ الاختبار إلى ${testPhone} ✓` : (d.error ?? "فشل الإرسال"));
    } catch { setTestMsg("خطأُ شبكة"); }
  }

  async function toggleBan(sub: Sub) {
    const banned = !sub.appBanned;
    if (banned && !confirm(`حظرُ «${sub.name ?? sub.phone ?? sub.id}» من التطبيق؟ لن يستطيع الدخولَ حتى تفكّ الحظر.`)) return;
    const res = await fetch("/api/app-admin/subscribers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sub.id, banned }) });
    if (res.ok) loadSubs(q, page);
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّرت العملية"); }
  }

  async function logout() { await fetch("/api/app-admin/logout", { method: "POST" }); window.location.reload(); }

  if (!s) return <div className="p-6 text-slate-400" dir="rtl">جاري التحميل...</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">📱 أدمن التطبيق</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">👤 {username}</span>
          <button onClick={logout} className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">خروج</button>
        </div>
      </div>

      {/* مشتركو التطبيق: العدّاد + قائمة الحظر */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-800">👥 مشتركو التطبيق</div>
        {counts && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="استعملوا التطبيق" value={counts.totalAppUsers} />
            <Stat label="نشطون (٣٠ يوماً)" value={counts.active30} />
            <Stat label="محظورون" value={counts.banned} danger={counts.banned > 0} />
          </div>
        )}
        <div className="mb-2 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadSubs(q, 1); }}
            placeholder="بحثٌ بالاسم أو الهاتف (لحظر أيّ مشترك)…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button onClick={() => loadSubs(q, 1)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">🔍 بحث</button>
        </div>
        <div className="text-[11px] text-slate-400 mb-2">{q.trim() ? `نتائجُ البحث: ${total}` : `يظهر مستعملو التطبيق (${total})`}</div>
        <div className="divide-y divide-slate-100">
          {subs.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">لا نتائج</div>
          ) : subs.map((sub) => (
            <div key={sub.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-700">
                  {sub.name || "—"}
                  {sub.appBanned && <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">محظور</span>}
                </div>
                <div className="text-[11px] text-slate-500" dir="ltr">
                  {sub.phone || "—"} · <span className={sub.state === "expired" ? "text-red-500" : sub.state === "grace" ? "text-amber-600" : "text-emerald-600"}>{STATE_LABEL[sub.state] ?? sub.state}</span>
                  {sub.lastAppLoginAt && <> · آخر دخول {new Date(sub.lastAppLoginAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })}</>}
                </div>
              </div>
              <button onClick={() => toggleBan(sub)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${sub.appBanned ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-red-100 text-red-700 hover:bg-red-200"}`}>
                {sub.appBanned ? "فكُّ الحظر" : "حظر"}
              </button>
            </div>
          ))}
        </div>
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm">
            <button disabled={page <= 1} onClick={() => loadSubs(q, page - 1)} className="rounded-lg bg-slate-100 px-3 py-1 disabled:opacity-40">‹</button>
            <span className="text-slate-500">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => loadSubs(q, page + 1)} className="rounded-lg bg-slate-100 px-3 py-1 disabled:opacity-40">›</button>
          </div>
        )}
      </div>

      {/* سوق المستعمل — الموديريشن */}
      <MarketModeration />

      {/* ربط واتساب OTP */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">واتساب رسائل OTP</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          رقمُ UltraMsg مركزيٌّ يُرسِلُ رموزَ التحقّق للمشتركين عند الدخول. أدخِل Instance ID والToken من لوحة UltraMsg.
        </div>
        <div className="grid gap-2">
          <label className="text-xs font-semibold text-slate-600">Instance ID
            <input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} dir="ltr" placeholder="instance000000" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Token
            <input value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" placeholder={s.otpWa.tokenSet ? "••••••••  (محفوظٌ — اتركه فارغاً للإبقاء)" : "الصق التوكِن"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-slate-600">رقمُ الاختبار
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} dir="ltr" placeholder="07XXXXXXXXX" className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <button onClick={() => void test()} className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-200">📤 اختبار</button>
            {testMsg && <span className="text-xs text-slate-600">{testMsg}</span>}
          </div>
          <p className="text-[11px] text-slate-400">احفظ أوّلاً ثمّ اختبر.</p>
        </div>
      </div>

      {/* الإعلانات والعروض */}
      <AdsEditor content={{ ads: s.ads, offers: s.offers, quick: s.quick }} onChange={(c) => setS({ ...s, ...c })} />

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-6 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${danger ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
      <div className={`text-2xl font-extrabold ${danger ? "text-red-600" : "text-slate-800"}`} dir="ltr">{value.toLocaleString("en-US")}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
