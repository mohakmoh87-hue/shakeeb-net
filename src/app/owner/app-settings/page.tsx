"use client";

import { useCallback, useEffect, useState } from "react";
import AdsEditor, { type AppContentT } from "@/components/AdsEditor";

type OtpWaInfo = { instanceId: string; tokenSet: boolean };
type TicketDest = "supercell" | "agent" | "both";
type State = AppContentT & { otpWa: OtpWaInfo; ticketDest: TicketDest; subsVisibleToCompany: boolean };

export default function OwnerAppSettingsPage() {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [ticketDest, setTicketDest] = useState<TicketDest>("both");
  const [subsVisible, setSubsVisible] = useState(false);

  const load = useCallback(() => {
    fetch("/api/owner/app-settings").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setS(d); setInstanceId(d.otpWa?.instanceId ?? ""); setToken(""); setTicketDest(d.ticketDest ?? "both"); setSubsVisible(!!d.subsVisibleToCompany); }
    });
  }, []);
  useEffect(() => { const t = setTimeout(() => load(), 0); return () => clearTimeout(t); }, [load]);

  if (!s) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  async function save() {
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/owner/app-settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { ads: s!.ads, offers: s!.offers, quick: s!.quick },
          otpWa: { instanceId, token },
          ticketDest,
          subsVisibleToCompany: subsVisible,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error ?? "فشل الحفظ"); return; }
      setMsg("✓ حُفِظ");
      load();
    } catch { setMsg("تعذّر الاتصال بالخادم"); }
    finally { setSaving(false); }
  }

  async function test() {
    if (!testPhone.trim()) { setTestMsg("أدخِل رقمَ الاختبار"); return; }
    setTestMsg("جارٍ الإرسال...");
    try {
      const res = await fetch("/api/owner/app-settings/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone }),
      });
      const d = await res.json().catch(() => ({}));
      setTestMsg(res.ok && d.ok ? `وصلت رسالةُ الاختبار إلى ${testPhone} ✓` : (d.error ?? "فشل الإرسال"));
    } catch { setTestMsg("خطأُ شبكة"); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">📱 إعدادات التطبيق</h1>
        <a href="/owner" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 hover:bg-slate-200">← رجوع</a>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">واتساب رسائل OTP</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          رقمُ UltraMsg مركزيٌّ يُرسِلُ رموزَ التحقّق للمشتركين عند الدخول. أدخِل Instance ID والToken من لوحة UltraMsg (Instances ← Manage).
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

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">🎫 وجهةُ تذاكر المشتركين</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          طلبُ اشتراكٍ جديدٍ من التطبيق (باسمه وهاتفه وأقرب عامودٍ ووكيله) — إلى أين يصل؟
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ["both", "الوكيل والشركة", "يظهرُ في إدارة الفنيين للوكيل وفي لوحة سوبر سيل معاً"],
            ["agent", "الوكيل فقط", "في إدارة الفنيين للوكيل صاحب أقرب عامود"],
            ["supercell", "سوبر سيل فقط", "في لوحة الشركة وحدها"],
          ] as [TicketDest, string, string][]).map(([val, label, hint]) => (
            <button key={val} type="button" onClick={() => setTicketDest(val)}
              className={`rounded-xl border p-3 text-right transition ${ticketDest === val ? "border-mynet-blue bg-blue-50 ring-1 ring-mynet-blue" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}>
              <div className={`text-sm font-bold ${ticketDest === val ? "text-mynet-blue" : "text-slate-700"}`}>{label}</div>
              <div className="mt-1 text-[10px] leading-4 text-slate-500">{hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 font-semibold text-slate-800">👁️ كشفُ مشتركي الوكلاء لبوّابة الشركة</div>
        <div className="mb-3 text-[11px] leading-5 text-slate-500">
          يسمحُ لبوّابة سوبر سيل بقراءة قائمة مشتركي وكيلٍ تختاره (اسم·هاتف·مكتب·باقة·انتهاء·حالة فقط — بلا أيّ كلمة سرٍّ أو بيانات دخول). <b className="text-rose-600">حسّاسٌ — مطفأٌ افتراضاً.</b>
        </div>
        <button type="button" onClick={() => setSubsVisible((v) => !v)}
          className={`flex w-full items-center justify-between rounded-xl border p-3 transition ${subsVisible ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}>
          <span className={`text-sm font-bold ${subsVisible ? "text-emerald-700" : "text-slate-600"}`}>{subsVisible ? "مفعّل — الشركةُ تستطيعُ القراءة" : "مطفأٌ — الشركةُ لا ترى المشتركين"}</span>
          <span className={`relative h-6 w-11 rounded-full transition ${subsVisible ? "bg-emerald-500" : "bg-slate-300"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${subsVisible ? "right-0.5" : "right-5"}`} />
          </span>
        </button>
      </div>

      <AdsEditor content={{ ads: s.ads, offers: s.offers, quick: s.quick }} onChange={(c) => setS({ ...s, ...c })} />

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/90 py-3 backdrop-blur">
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        <button onClick={save} disabled={saving} className="rounded-lg bg-mynet-blue px-6 py-2 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
      </div>
    </div>
  );
}
