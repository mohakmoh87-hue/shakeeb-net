"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type Template = { id: number; type: string | null; text: string | null };

const CHANNELS = [
  { key: "SMS", label: "SMS", icon: "✉️" },
  { key: "WHATSAPP", label: "واتساب", icon: "💬" },
  { key: "TELEGRAM", label: "تيليغرام", icon: "✈️" },
] as const;

const TARGETS = [
  { key: "all", label: "كل المشتركين" },
  { key: "expiring", label: "المشتركون قرب الانتهاء" },
  { key: "expiringRange", label: "المنتهون بين تاريخين" },
  { key: "debtors", label: "المشتركون المدينون" },
  { key: "search", label: "بحث مخصّص (اسم/يوزر/هاتف)" },
] as const;

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">جاري التحميل...</div>}>
      <ComposeInner />
    </Suspense>
  );
}

function ComposeInner() {
  const search = useSearchParams();
  const preSub = search.get("subscriberId");

  const [channel, setChannel] = useState<"SMS" | "WHATSAPP" | "TELEGRAM">("SMS");
  const [target, setTarget] = useState<"all" | "expiring" | "expiringRange" | "debtors" | "search" | "one">(
    preSub ? "one" : "all",
  );
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [text, setText] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // #18: الإرسال صامت افتراضياً (من إعدادات المكتب)، مع خيار طلب التأكيد
  const [confirmBeforeSend, setConfirmBeforeSend] = useState(false);

  useEffect(() => {
    fetch("/api/sms-templates").then((r) => void (r.ok && r.json().then(setTemplates)));
    // اقرأ إعداد الصمت الافتراضي؛ إن كان مُطفأ يُطلب التأكيد افتراضياً
    fetch("/api/settings").then((r) => void (r.ok && r.json().then((s: Record<string, string>) => {
      setConfirmBeforeSend(s.silent === "0");
    })));
  }, []);

  async function send() {
    setError("");
    setResult("");
    if (!text.trim()) { setError("اكتب نص الرسالة"); return; }
    // تأكيد اختياري قبل الإرسال (غير صامت)
    if (confirmBeforeSend && !window.confirm("هل تريد إرسال الرسالة الآن؟")) return;
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          text,
          target,
          subscriberId: preSub ? Number(preSub) : undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          search: searchQ || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل الإرسال"); return; }
      setResult(`تم الإرسال إلى ${data.sent} مشترك (فشل ${data.failed}) من أصل ${data.total}`);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally { setSending(false); }
  }

  return (
    <div className="p-6">
      <PageHeader
        title={preSub ? "إرسال رسالة" : "إرسال رسالة للكل"}
        subtitle="إرسال إشعار للمشتركين عبر SMS أو واتساب أو تيليغرام"
      />

      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* القناة */}
        <label className="mb-1 block text-sm font-medium text-slate-700">القناة</label>
        <div className="mb-4 flex gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              onClick={() => setChannel(c.key)}
              className={`flex-1 rounded-lg py-2 font-semibold transition ${channel === c.key ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {/* المستلمون */}
        {!preSub && (
          <>
            <label className="mb-1 block text-sm font-medium text-slate-700">المستلمون</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as typeof target)}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
            >
              {TARGETS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>

            {/* المنتهون بين تاريخين */}
            {target === "expiringRange" && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600">من تاريخ انتهاء</label>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600">إلى تاريخ انتهاء</label>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
              </div>
            )}

            {/* بحث مخصّص + نطاق تاريخ (يُدمجان معاً) */}
            {target === "search" && (
              <div className="mb-4 space-y-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600">أحرف من الاسم أو اليوزر أو الهاتف</label>
                  <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="مثال: bg-1-  أو  ahmed  أو  0770" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-600">من تاريخ انتهاء (اختياري)</label>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-600">إلى تاريخ انتهاء (اختياري)</label>
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </div>
                </div>
                <div className="text-xs text-slate-400">يُرسل لكل مشترك يطابق الأحرف <b>و</b> ينتهي اشتراكه ضمن التاريخين (اترك التاريخ فارغاً لتجاهله).</div>
              </div>
            )}
          </>
        )}

        {/* قالب جاهز */}
        {templates.length > 0 && (
          <>
            <label className="mb-1 block text-sm font-medium text-slate-700">قالب جاهز (اختياري)</label>
            <select
              onChange={(e) => {
                const t = templates.find((x) => x.id === Number(e.target.value));
                if (t?.text) setText(t.text);
              }}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
            >
              <option value="">— اختر قالباً لتحميله —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.type}</option>
              ))}
            </select>
          </>
        )}

        {/* النص */}
        <label className="mb-1 block text-sm font-medium text-slate-700">نص الرسالة</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="مرحباً {name}، ينتهي اشتراكك بتاريخ {dateTo}. المتبقّي عليك {carry} د.ع — {office}"
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
        />
        <div className="mb-4 text-xs text-slate-500">
          المتغيّرات المتاحة: <code>{"{name}"}</code> <code>{"{netUser}"}</code>{" "}
          <code>{"{price}"}</code> <code>{"{dateTo}"}</code> <code>{"{carry}"}</code> <code>{"{office}"}</code>
        </div>

        {/* #18: خيار طلب التأكيد قبل الإرسال (الافتراضي صامت من الإعدادات) */}
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={confirmBeforeSend} onChange={(e) => setConfirmBeforeSend(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          طلب تأكيد قبل الإرسال (بدون تفعيله يُرسل مباشرة بصمت)
        </label>

        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {result && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ {result}</div>}

        <button
          onClick={send}
          disabled={sending}
          className="w-full rounded-lg bg-mynet-blue py-3 text-lg font-bold text-white shadow hover:bg-mynet-blue-dark disabled:opacity-60"
        >
          {sending ? "جاري الإرسال..." : "إرسال 📤"}
        </button>

        <p className="mt-3 text-center text-xs text-slate-500">
          واتساب يُرسل فعلياً عبر الجلسة المربوطة في الإعدادات. أما SMS/تيليغرام فتُسجَّل دون إرسال فعلي حتى ربط مزوّد.
        </p>
      </div>
    </div>
  );
}
