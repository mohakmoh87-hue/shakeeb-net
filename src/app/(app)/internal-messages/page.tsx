"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

// ═════ 📬 صفحة «رسالة داخلية» (طلب محمد — 2026-08-20) ═════
// المدير أو المستخدم يُرسل نصّاً حرّاً لفنيٍّ أو مستخدمٍ فيظهر عنده منبثقةً لا تُغلق
// إلّا بـX وله الردّ. الفنيُّ لا يدخل هذه الصفحة أصلاً (لا يُنشئ — يردّ فقط من المنبثقة).
// القوائمُ تأتي معزولةً من الخادم: فنّيّو مكاتب الوكيل + مستخدمو الوكيل نفسِه حصراً.

type Person = { id: number; name: string | null; isAdmin?: boolean };
type Sent = { id: number; text: string; createdAt: string; closedAt: string | null; toName: string; replyToId: number | null };

export default function InternalMessagesPage() {
  const [techs, setTechs] = useState<Person[]>([]);
  const [users, setUsers] = useState<Person[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [kind, setKind] = useState<"tech" | "user">("tech");
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetch("/api/internal-messages?compose=1&sent=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setTechs(Array.isArray(d.techs) ? d.techs : []);
        setUsers(Array.isArray(d.users) ? d.users : []);
        setSent(Array.isArray(d.sent) ? d.sent : []);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function send() {
    if (!target || !text.trim() || busy) return;
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await fetch("/api/internal-messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), ...(kind === "tech" ? { toTechId: Number(target) } : { toUserId: Number(target) }) }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setErr(d.error ?? "تعذّر الإرسال"); return; }
      setText(""); setMsg("✓ أُرسلت — ستبقى ظاهرةً عنده حتى يغلقها بنفسه، وردُّه يصلك منبثقةً");
      load();
    } catch { setBusy(false); setErr("تعذّر الاتصال بالخادم"); }
  }

  const list = kind === "tech" ? techs : users;
  const fmtWhen = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

  return (
    <div className="p-6">
      <PageHeader title="رسالة داخلية" subtitle="رسالة منبثقة تصل فنيّاً أو مستخدماً وتبقى على شاشته حتى يغلقها — وله الردّ عليك" />

      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          <button onClick={() => { setKind("tech"); setTarget(""); }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${kind === "tech" ? "bg-mynet-blue text-white shadow" : "text-slate-500"}`}>👷 إلى فني</button>
          <button onClick={() => { setKind("user"); setTarget(""); }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${kind === "user" ? "bg-mynet-blue text-white shadow" : "text-slate-500"}`}>👤 إلى مستخدم / مدير</button>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">{kind === "tech" ? "الفني" : "المستخدم"}</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue">
          <option value="">— اختر —</option>
          {list.map((p) => (
            <option key={p.id} value={p.id}>{p.name ?? `#${p.id}`}{p.isAdmin ? " — مدير" : ""}</option>
          ))}
        </select>
        {list.length === 0 && <div className="-mt-2 mb-3 text-xs text-slate-400">{kind === "tech" ? "لا فنيّين في مكاتبك" : "لا مستخدمين آخرين في حسابك"}</div>}

        <label className="mb-1 block text-sm font-medium text-slate-700">نصّ الرسالة</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000}
          placeholder="اكتب ما تشاء…" className="mb-3 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-mynet-blue" />

        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
        {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{msg}</div>}

        <button onClick={send} disabled={busy || !target || !text.trim()}
          className="w-full rounded-lg bg-mynet-blue py-2.5 font-bold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "جارٍ…" : "📩 إرسال"}
        </button>
      </div>

      {sent.length > 0 && (
        <div className="mt-5 max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-bold text-slate-700">آخر ما أرسلتَه</div>
          <ul className="space-y-1.5">
            {sent.map((s) => (
              <li key={s.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-700">{s.replyToId != null ? "↩️ ردّ إلى" : "إلى"} {s.toName}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-slate-400" dir="ltr">{fmtWhen(s.createdAt)}</span>
                    {/* «أُغلقت» = ضغط X بعد أن رآها — أوثقُ من أيّ «شوهدت» */}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.closedAt ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {s.closedAt ? "أُغلقت عنده ✓" : "ما زالت ظاهرة"}
                    </span>
                  </span>
                </div>
                <div className="truncate text-slate-500">{s.text}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
