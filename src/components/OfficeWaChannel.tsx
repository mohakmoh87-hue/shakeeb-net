"use client";

import { useCallback, useEffect, useState } from "react";
import { usePermission } from "@/lib/usePermission";

type Info = { enabled: boolean; provider: string; instanceId: string; tokenSet: boolean };

export default function OfficeWaChannel({ officeId }: { officeId: number }) {
  const { can } = usePermission();
  const canConnect = can("whatsapp.connect");

  const [info, setInfo] = useState<Info | null>(null);
  const [mode, setMode] = useState<"qr" | "ultramsg">("qr");
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/whatsapp/channel?officeId=${officeId}`);
    if (!r.ok) return;
    const d: Info = await r.json();
    setInfo(d);
    setMode(d.enabled ? "ultramsg" : "qr");
    setInstanceId(d.instanceId ?? "");
    setToken("");
  }, [officeId]);

  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (!canConnect) return null;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/whatsapp/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeId, enabled: mode === "ultramsg", instanceId, token }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: d?.error ?? "تعذّر الحفظ" }); return; }
      setInfo(d); setToken("");
      setMsg({ kind: "ok", text: mode === "ultramsg" ? "حُفِظ ✓ — الإرسالُ الآن عبر UltraMsg" : "حُفِظ ✓ — الإرسالُ على الطريقة الحاليّة (QR)" });
    } catch {
      setMsg({ kind: "err", text: "خطأُ شبكة" });
    } finally { setBusy(false); }
  }

  async function test() {
    if (!testPhone.trim()) { setMsg({ kind: "err", text: "أدخِل رقمَ الاختبار أوّلاً" }); return; }
    setBusy(true); setMsg({ kind: "info", text: "جارٍ إرسالُ رسالة اختبار..." });
    try {
      const r = await fetch("/api/whatsapp/channel/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeId, phone: testPhone }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) setMsg({ kind: "ok", text: `وصلت رسالةُ الاختبار إلى ${testPhone} ✓` });
      else setMsg({ kind: "err", text: d?.error ?? "فشل إرسالُ الاختبار" });
    } catch {
      setMsg({ kind: "err", text: "خطأُ شبكة" });
    } finally { setBusy(false); }
  }

  const active = info?.enabled ? "UltraMsg" : "الطريقة الحاليّة (QR)";

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-1 font-bold text-slate-800">قناةُ الإرسال</h3>
      <p className="mb-3 text-xs leading-5 text-slate-500">
        اختر من أين تخرجُ رسائلُ هذا المكتب: الطريقةُ الحاليّة (QR على حاسبة المكتب)، أو <b>UltraMsg</b>
        {" "}(بوّابةٌ سحابيّةٌ تُرسِلُ ٢٤/٧ بلا حاجةٍ لحاسبة المكتب). قناةٌ واحدةٌ فعّالةٌ في كلّ وقت.
      </p>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className={`inline-block h-3 w-3 rounded-full ${info?.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
        <span className="font-semibold text-slate-700">القناةُ الفعّالة الآن: {active}</span>
      </div>

      {/* اختيارُ القناة */}
      <div className="mb-3 grid gap-2">
        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${mode === "qr" ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
          <input type="radio" name={`wachan-${officeId}`} className="mt-1" checked={mode === "qr"} onChange={() => setMode("qr")} />
          <span className="text-sm">
            <b className="text-slate-800">الطريقةُ الحاليّة (QR)</b>
            <span className="block text-xs text-slate-500">الإرسالُ من حاسبة المكتب — كما هو الآن. لا شيءَ يتغيّر.</span>
          </span>
        </label>
        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${mode === "ultramsg" ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
          <input type="radio" name={`wachan-${officeId}`} className="mt-1" checked={mode === "ultramsg"} onChange={() => setMode("ultramsg")} />
          <span className="text-sm">
            <b className="text-slate-800">UltraMsg (API)</b>
            <span className="block text-xs text-slate-500">إرسالٌ سحابيٌّ ٢٤/٧. أدخِل Instance ID والToken من لوحة UltraMsg.</span>
          </span>
        </label>
      </div>

      {/* حقولُ UltraMsg */}
      {mode === "ultramsg" && (
        <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-semibold text-slate-600">Instance ID
            <input
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              placeholder="instance000000"
              dir="ltr"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">Token
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={info?.tokenSet ? "••••••••  (محفوظٌ — اتركه فارغاً للإبقاء عليه)" : "الصق التوكِن هنا"}
              dir="ltr"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-[11px] leading-4 text-slate-500">
            من user.ultramsg.com ← Instances ← Manage: انسخ <b>Instance ID</b> و<b>Token</b> من الشريط الأعلى.
            لا تضغط زرَّ ↻ بجانب التوكِن (يُبطِله).
          </p>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-slate-600">رقمُ الاختبار
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="07XXXXXXXXX"
                dir="ltr"
                className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              onClick={() => void test()}
              disabled={busy}
              className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-200 disabled:opacity-50"
            >📤 اختبار</button>
          </div>
          <p className="text-[11px] text-slate-400">احفظ أوّلاً ثمّ اختبر — الاختبارُ يستعملُ التوكِنَ المحفوظ.</p>
        </div>
      )}

      {msg && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : msg.kind === "err" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-700"}`}>
          {msg.text}
        </div>
      )}

      <button
        onClick={() => void save()}
        disabled={busy}
        className="w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >حفظُ قناة الإرسال</button>
    </div>
  );
}
