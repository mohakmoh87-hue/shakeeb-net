"use client";

import { useState } from "react";

type Loc = { name: string; gmaps: string; waze: string };

// زر «خريطة»: يجلب موقع المشترك (بـ subscriberId أو netUser أو نصّ بطاقة)
// ويعرض زرَّي ملاحة (خرائط جوجل + Waze). الموقع يُشتق تلقائياً من اليوزر.
export default function MapButton({
  subscriberId, netUser, text, towerId, size = "md", className = "",
}: {
  subscriberId?: number; netUser?: string | null; text?: string | null; towerId?: number | null;
  size?: "sm" | "md"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // ===== عمودٌ بلا موقع: الفني الواقف عنده يرسله (طلب محمد 2026-08-05) =====
  // الخيار لا يظهر إلا لمن **لا موقع له** — فمن له موقع لا شأن له بهذا.
  const [noLoc, setNoLoc] = useState(false); // فشل التحديد ⇒ يجوز الإرسال
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState("");

  async function fetchLoc() {
    setLoading(true); setErr(""); setNoLoc(false); setSent("");
    const qs = new URLSearchParams();
    if (subscriberId) qs.set("subscriberId", String(subscriberId));
    if (netUser) qs.set("netUser", netUser);
    if (text) qs.set("text", text);
    if (towerId) qs.set("towerId", String(towerId));
    try {
      const r = await fetch(`/api/map/resolve?${qs.toString()}`);
      const d = await r.json();
      if (r.ok) { setLoc(d); setOpen(true); }
      else { setErr(d.error ?? "تعذّر تحديد الموقع"); setNoLoc(r.status === 404); }
    } catch { setErr("تعذّر تحديد الموقع"); }
    setLoading(false);
  }

  // يقرأ موقع الجهاز ويرسله للمدير ليقبله — لا يُكتب في الخريطة إلا بقبوله
  function sendPole() {
    if (!navigator.geolocation) { setSent("هذا الجهاز لا يدعم تحديد الموقع"); return; }
    setSending(true); setSent("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch("/api/field/map-proposal", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscriberId, netUser, text, towerId,
              lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
            }),
          });
          const d = await r.json().catch(() => ({}));
          setSending(false);
          setSent(r.ok
            ? `✓ أُرسل موقع العمود ${d.name ?? ""} — بانتظار قبول المدير`
            : (d.error ?? "تعذّر الإرسال"));
        } catch { setSending(false); setSent("تعذّر الإرسال"); }
      },
      (e) => { setSending(false); setSent(e.code === 1 ? "امنح التطبيق إذن الموقع ثم أعد المحاولة" : "تعذّرت قراءة موقعك — جرّب في مكان مكشوف"); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  const btnCls = size === "sm"
    ? "px-2 py-1 text-[11px]"
    : "px-3 py-1.5 text-xs";

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); fetchLoc(); }}
        disabled={loading}
        title="عرض الموقع على الخريطة"
        className={`inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 ${btnCls} ${className}`}
      >
        🗺️ {loading ? "…" : "خريطة"}
      </button>
      {err && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => { setErr(""); setSent(""); }}>
          <div className="my-auto max-h-[92dvh] w-full max-w-xs overflow-y-auto rounded-2xl bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-3xl">📍</div>
            <div className="mb-3 text-sm font-semibold text-slate-700">{err}</div>
            {/* عمودٌ ليس على الخريطة: أنت واقفٌ عنده الآن — أرسِله */}
            {noLoc && !sent.startsWith("✓") && (
              <>
                <button
                  onClick={sendPole}
                  disabled={sending}
                  className="mb-2 w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {sending ? "…جاري قراءة موقعك" : "📡 أرسل موقع العمود من هنا"}
                </button>
                <div className="mb-3 text-[11px] leading-5 text-slate-500">
                  قِف بجانب العمود ثم اضغط. يصل المدير إشعارٌ، ولا يُضاف للخريطة إلا بقبوله.
                </div>
              </>
            )}
            {sent && (
              <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${sent.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{sent}</div>
            )}
            <button onClick={() => { setErr(""); setSent(""); }} className="w-full rounded-lg bg-slate-100 py-2 text-slate-600">حسناً</button>
          </div>
        </div>
      )}
      {open && loc && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[92dvh] w-full max-w-xs overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-center text-lg font-bold text-slate-800">📍 موقع المشترك</div>
            <div className="mb-4 text-center text-xs text-slate-400" dir="ltr">{loc.name}</div>
            <a href={loc.gmaps} target="_blank" rel="noreferrer" className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-700">
              🗺️ خرائط جوجل
            </a>
            <a href={loc.waze} target="_blank" rel="noreferrer" className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-bold text-white hover:bg-sky-600">
              🧭 Waze
            </a>
            <button onClick={() => setOpen(false)} className="w-full rounded-lg bg-slate-100 py-2 text-slate-600 hover:bg-slate-200">إغلاق</button>
          </div>
        </div>
      )}
    </>
  );
}
