"use client";

import { useEffect, useState } from "react";

type Pending = { officeId: number; officeName: string | null; count: number };

// إشعار عند أول دخول يومي: يسأل المستخدم إن أراد إرسال تذكير الانتهاء
// (يظهر فقط لمكاتب "الإرسال الصامت مُطفأ" التي لم تُعالَج اليوم وفيها منتهون خلال يومين)
export default function ReminderPrompt() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/reminders/pending").then((r) => void (r.ok && r.json().then((d) => setQueue(d.pending ?? []))));
  }, []);

  if (queue.length === 0) return null;
  const cur = queue[0];

  async function handle(send: boolean) {
    setBusy(true);
    await fetch("/api/reminders/handle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: cur.officeId, send }),
    }).catch(() => {});
    setBusy(false);
    setQueue((q) => q.slice(1)); // انتقل للمكتب التالي إن وُجد
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xl">⏰</span>
          <h3 className="text-lg font-bold text-slate-800">تذكير انتهاء الاشتراك</h3>
        </div>
        <p className="mb-1 text-sm text-slate-600">
          مكتب <b>{cur.officeName ?? "—"}</b>: يوجد <b>{cur.count}</b> مشترك ينتهي اشتراكه خلال يومين.
        </p>
        <p className="mb-4 text-sm text-slate-500">هل تريد إرسال رسالة تذكير لهم الآن عبر واتساب؟</p>
        <div className="flex gap-2">
          <button onClick={() => handle(true)} disabled={busy} className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? "جاري الإرسال..." : "نعم، أرسل الآن"}
          </button>
          <button onClick={() => handle(false)} disabled={busy} className="flex-1 rounded-lg bg-slate-100 py-2.5 font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60">
            ليس الآن
          </button>
        </div>
      </div>
    </div>
  );
}
