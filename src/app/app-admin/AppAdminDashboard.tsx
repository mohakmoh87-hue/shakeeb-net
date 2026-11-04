"use client";

import { useCallback, useEffect, useState } from "react";
import AdsEditor, { type AppContentT } from "@/components/AdsEditor";
import MarketModeration from "./MarketModeration";
import MarketReview from "./MarketReview";
import PopupAds from "./PopupAds";

type OtpWaInfo = { baseUrl: string; instanceId: string; tokenSet: boolean };
type State = AppContentT & { otpWa: OtpWaInfo; inviteBonus?: number };
type Counts = { totalAppUsers: number; active30: number; banned: number };
type Sub = { id: number; name: string | null; phone: string | null; appBanned: boolean; lastAppLoginAt: string | null; state: string; daysExpired: number };

const STATE_LABEL: Record<string, string> = { active: "فعّال", grace: "مهلة", expired: "منتهٍ" };

type TestUser = { user: string; name: string; state: string };
type TestOffice = { id: number; name: string };

export default function AppAdminDashboard({ username }: { username: string }) {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [inviteBonus, setInviteBonus] = useState("0");
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("");
  // 👤 حساباتُ التجريب
  const [tUsers, setTUsers] = useState<TestUser[]>([]);
  const [tOffices, setTOffices] = useState<TestOffice[]>([]);
  const [tOffice, setTOffice] = useState("");
  const [tMsg, setTMsg] = useState("");
  const [tBusy, setTBusy] = useState(false);
  // مشتركو التطبيق
  const [marketPanel, setMarketPanel] = useState(false);
  const [marketPending, setMarketPending] = useState(0);
  const [marketToken, setMarketToken] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);

  const loadConfig = useCallback(() => {
    fetch("/api/app-admin/config").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setS(d); setBaseUrl(d.otpWa?.baseUrl ?? ""); setInstanceId(d.otpWa?.instanceId ?? ""); setToken(""); setInviteBonus(String(d.inviteBonus ?? 0)); }
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
  const loadTest = useCallback(() => {
    fetch("/api/app-admin/test-users").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setTUsers(d.users ?? []); setTOffices(d.offices ?? []);
      setTOffice((prev) => prev || String(d.offices?.[0]?.id ?? ""));
    });
  }, []);
  const loadPending = useCallback(() => {
    fetch("/api/app-admin/market?only=pending&page=1").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setMarketPending(d.counts?.pending ?? 0);
    }).catch(() => {});
  }, []);
  useEffect(() => { const t = setTimeout(() => { loadConfig(); loadSubs("", 1); loadTest(); loadPending(); }, 0); return () => clearTimeout(t); }, [loadConfig, loadSubs, loadTest, loadPending]);

  async function testUsersAction(action: "seed" | "disable") {
    if (action === "disable" && !confirm("إيقافُ حسابات التجريب؟ تُخفى ولا تُحذَف، ويعيدها زرُّ الإنشاء.")) return;
    setTBusy(true); setTMsg("");
    try {
      const res = await fetch("/api/app-admin/test-users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "seed" && tOffice ? { officeId: Number(tOffice) } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setTMsg(d.error ?? "تعذّرت العملية"); return; }
      setTUsers(d.users ?? []); setTOffices(d.offices ?? []);
      setTMsg(action === "seed" ? `✓ جاهزةٌ على ${d.officeName ?? "المكتب"} — كلمةُ المرور 123456` : "✓ أُوقفت");
    } catch { setTMsg("تعذّر الاتصال بالخادم"); }
    finally { setTBusy(false); }
  }

  async function save() {
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/app-admin/config", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { ads: s!.ads, offers: s!.offers, quick: s!.quick, videos: s!.videos ?? [], faqs: s!.faqs ?? [], about: s!.about ?? "" }, otpWa: { baseUrl, instanceId, token }, inviteBonus: Number(inviteBonus) || 0 }),
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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">📱 أدمن التطبيق</h1>
          <button onClick={() => setMarketPanel((v) => !v)}
            className={`relative rounded-lg px-3 py-2 text-sm font-semibold ${marketPanel ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-sky-100 text-sky-700 hover:bg-sky-200"}`}>
            🏷️ فئاتُ السوق
            {marketPending > 0 && <span className="absolute -left-1.5 -top-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-extrabold text-white">{marketPending}</span>}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">👤 {username}</span>
          <button onClick={logout} className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">خروج</button>
        </div>
      </div>

      {marketPanel && <MarketReview onChanged={() => { loadPending(); setMarketToken((v) => v + 1); }} />}

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
      <PopupAds />

      <MarketModeration reloadToken={marketToken} />

      {/* ربط واتساب OTP */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">واتساب رسائل OTP</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          رقمٌ مركزيٌّ يُرسِلُ رموزَ التحقّق للمشتركين عند الدخول. أدخِل رابطَ البوّابة وInstance ID والToken — من بوّابتك الخاصّة، أو من لوحة UltraMsg.
        </div>
        <div className="grid gap-2">
          <label className="text-xs font-semibold text-slate-600">رابطُ البوّابة
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} dir="ltr" placeholder="https://api.ultramsg.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">بوّابتُك: <button type="button" onClick={() => setBaseUrl("https://wa.shakeebnet.com")} className="font-semibold text-sky-700 underline" dir="ltr">https://wa.shakeebnet.com</button> — أو اتركه على UltraMsg.</span>
          </label>
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

      {/* 🎁 دعوة صديق */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">🎁 دعوةُ صديق</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          المشتركُ الفعّالُ يولّد كوداً من «حسابي» ويعطيه صديقَه؛ يضعه صديقُه في طلب التنصيب، فحين يُنجَز الطلبُ فعلاً
          يُضاف هذا المبلغُ إلى رصيد كود خصمِ الداعي ويُستعمَل كأيّ رصيدٍ عند الفنيّ. صفرٌ = البرنامجُ متوقّف.
        </div>
        <label className="text-xs font-semibold text-slate-600">مبلغُ المكافأة للداعي (دينار)
          <input type="number" min={0} value={inviteBonus} onChange={(e) => setInviteBonus(e.target.value)} dir="ltr" className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>

      {/* 👤 حسابات التجريب */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">👤 حساباتُ التجريب</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          أربعةُ حساباتٍ للتجربة من داخل التطبيق: <b>test1</b> مشتركٌ فعّال · <b>test2</b> منتهٍ منذ عشرة أيّام ·
          <b> test3</b> منتهٍ منذ سنة · <b>test4</b> مسجَّلٌ غيرُ مشترك. كلمةُ المرور <b dir="ltr">123456</b> للأربعة،
          وتُكتَب في خانة الهاتف نفسِها. لا تظهر في مشتركي المكتب، ولا تصلها رسالةُ واتساب، ولا أثرَ ماليَّ لها.
          وإعادةُ الضغط تُجدّد التواريخَ (فيبقى <b>test1</b> فعّالاً دائماً).
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tOffices.length > 1 && (
            <select value={tOffice} onChange={(e) => setTOffice(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {tOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button onClick={() => void testUsersAction("seed")} disabled={tBusy} className="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-200 disabled:opacity-60">🧪 إنشاء / تحديث</button>
          <button onClick={() => void testUsersAction("disable")} disabled={tBusy || !tUsers.length} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60">⏸️ إيقاف</button>
          {tMsg && <span className="text-xs text-slate-600">{tMsg}</span>}
        </div>
        {tUsers.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-1.5 text-right">اليوزر</th><th className="px-2 py-1.5 text-right">الاسم</th><th className="px-2 py-1.5 text-right">الحالة</th></tr></thead>
              <tbody>
                {tUsers.map((u) => (
                  <tr key={u.user} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-semibold text-slate-800" dir="ltr">{u.user}</td>
                    <td className="px-2 py-1.5 text-slate-600">{u.name}</td>
                    <td className="px-2 py-1.5 text-slate-600">{u.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* الإعلانات والعروض */}
      <AdsEditor content={{ ads: s.ads, offers: s.offers, quick: s.quick, videos: s.videos ?? [], faqs: s.faqs ?? [], about: s.about ?? "" }} onChange={(c) => setS({ ...s, ...c })} />

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
