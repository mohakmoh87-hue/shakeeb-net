"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 👁️ لوحةُ مستخدم المشاهدة — صفحتُه الوحيدة (طلبُ محمد 2026-11-21).
// بحثٌ بالاسم أو اليوزر · حالةُ اتصالٍ بالضغط على الصفّ · وزرُّ عمليّاتٍ يرفع بطاقة.
// 🔴 ولا هاتفَ إطلاقاً: المسارُ لا يُرجعه أصلاً، فلا شيءَ يُخفى هنا بالعرض.
// و`SubscribersBoard` (١٣٧٠ سطراً فيه المالُ والتفعيلُ والحذف) لا علاقةَ له بهذا الملفّ.

type Sub = { id: number; name: string | null; netUser: string | null; towerId: number | null };
type Office = { id: number; name: string | null };
type Status = { id: number; state: "loading" | "online" | "offline" | "unknown" };

export default function WatchBoard() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [allOffices, setAllOffices] = useState(false);
  const [myName, setMyName] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [total, setTotal] = useState(0);
  const [limited, setLimited] = useState(false);

  const [selId, setSelId] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  // نافذةُ العمليّات
  const [opsSub, setOpsSub] = useState<Sub | null>(null);
  const [ops, setOps] = useState<string[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [op, setOp] = useState("");
  const [extraPhone, setExtraPhone] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [opsMsg, setOpsMsg] = useState("");
  const [opsErr, setOpsErr] = useState("");

  const reqId = useRef(0);

  const load = useCallback((term: string) => {
    const mine = ++reqId.current;
    setLoading(true);
    setErr("");
    fetch(`/api/watch/subscribers${term ? `?q=${encodeURIComponent(term)}` : ""}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "تعذّر التحميل");
        const lim = Number(r.headers.get("X-Limit") ?? 0);
        const tot = Number(r.headers.get("X-Total-Count") ?? 0);
        const d = (await r.json()) as { items: Sub[]; offices: Office[]; allOffices: boolean; name: string };
        return { d, lim, tot };
      })
      .then(({ d, lim, tot }) => {
        if (reqId.current !== mine) return;
        setSubs(d.items);
        setOffices(d.offices ?? []);
        setAllOffices(!!d.allOffices);
        setMyName(d.name ?? "");
        setTotal(tot);
        setLimited(d.items.length >= lim && lim > 0);
      })
      .catch((e: Error) => { if (reqId.current === mine) setErr(e.message); })
      .finally(() => { if (reqId.current === mine) setLoading(false); });
  }, []);

  // بحثٌ مؤجَّلٌ ٣٥٠ms — لا طلبَ بكلّ حرف. وهو نفسُه يُحمِّل أوّلَ مرّةٍ (q فارغة)،
  // فلا تحميلٌ أوّليٌّ منفصلٌ يجلب القائمةَ مرّتَين عند فتح الصفحة.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q, load]);

  function officeName(id: number | null) {
    if (id == null) return "—";
    return offices.find((o) => o.id === id)?.name ?? `#${id}`;
  }

  function selectRow(s: Sub) {
    if (selId === s.id) { setSelId(null); setStatus(null); return; }
    setSelId(s.id);
    setStatus({ id: s.id, state: "loading" });
    fetch(`/api/watch/sas-status/${s.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { online?: boolean | null } | null) =>
        setStatus((p) => (p?.id === s.id
          ? { id: s.id, state: d == null ? "unknown" : d.online === true ? "online" : d.online === false ? "offline" : "unknown" }
          : p)))
      .catch(() => setStatus((p) => (p?.id === s.id ? { id: s.id, state: "unknown" } : p)));
  }

  function openOps(s: Sub) {
    setOpsSub(s); setOp(""); setExtraPhone(""); setNote(""); setOpsMsg(""); setOpsErr("");
    setOps([]); setOpsLoading(true);
    fetch(`/api/watch/ops?officeId=${s.towerId ?? 0}`)
      .then((r) => (r.ok ? r.json() : { ops: [] }))
      .then((d: { ops?: string[] }) => setOps(d.ops ?? []))
      .catch(() => setOps([]))
      .finally(() => setOpsLoading(false));
  }

  async function submitOps() {
    if (!opsSub || !op || sending) return;
    setSending(true); setOpsErr(""); setOpsMsg("");
    try {
      const r = await fetch("/api/watch/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberId: opsSub.id, operation: op, extraPhone, note }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; listName?: string; error?: string } | null;
      if (!r.ok || !d?.ok) { setOpsErr(d?.error ?? "تعذّر رفع الطلب"); return; }
      setOpsMsg(`✅ رُفع الطلب في عمود «${d.listName}»`);
      setOp(""); setExtraPhone(""); setNote("");
    } catch {
      setOpsErr("تعذّر الاتّصال — حاول مرّةً أخرى");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4" dir="rtl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800">👁️ المشتركون</h1>
          <p className="text-xs font-semibold text-slate-500">
            {myName ? `${myName} · ` : ""}مشاهدةٌ فقط{total > 0 ? ` · ${total.toLocaleString("en-US")} مشترك` : ""}
          </p>
        </div>
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={(e) => { e.preventDefault(); load(q.trim()); }}>
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو اليوزر…"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-sky-500 sm:w-64" />
          {q && (
            <button type="button" onClick={() => setQ("")} title="مسح البحث"
              className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">✕</button>
          )}
        </form>
      </header>

      {err && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
          ⚠️ {err}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[70dvh] overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-right text-xs font-extrabold">اسم المشترك</th>
                <th className="w-14 px-2 py-2 text-center text-xs font-extrabold">عمليات</th>
                <th className="px-3 py-2 text-right text-xs font-extrabold">اليوزر</th>
                {allOffices && <th className="px-3 py-2 text-right text-xs font-extrabold">المكتب</th>}
              </tr>
            </thead>
            <tbody>
              {loading && subs.length === 0 && (
                <tr><td colSpan={allOffices ? 4 : 3} className="px-3 py-10 text-center text-sm font-semibold text-slate-400">… جارٍ التحميل</td></tr>
              )}
              {!loading && subs.length === 0 && (
                <tr><td colSpan={allOffices ? 4 : 3} className="px-3 py-10 text-center text-sm font-semibold text-slate-400">
                  {q ? "لا نتيجة لهذا البحث" : "لا مشتركين"}
                </td></tr>
              )}
              {subs.map((s) => {
                const on = selId === s.id;
                return [
                  <tr key={s.id} onClick={() => selectRow(s)}
                    className={`cursor-pointer border-t border-slate-100 ${on ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                    <td className="px-3 py-2 font-bold text-slate-800">{s.name || "—"}</td>
                    <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openOps(s)} title="رفع طلب لهذا المشترك"
                        className="rounded-lg bg-amber-50 px-2 py-1 text-base leading-none text-amber-700 hover:bg-amber-100">🛠️</button>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-600" dir="ltr">{s.netUser || "—"}</td>
                    {allOffices && <td className="px-3 py-2 text-xs font-semibold text-slate-500">{officeName(s.towerId)}</td>}
                  </tr>,
                  on ? (
                    <tr key={`${s.id}-st`} className="border-t border-sky-100 bg-sky-50/60">
                      <td colSpan={allOffices ? 4 : 3} className="px-3 py-2">
                        <span className="rounded-lg px-2.5 py-1 text-xs font-extrabold text-white"
                          style={{
                            background: status?.state === "online" ? "#16a34a"
                              : status?.state === "offline" ? "#dc2626"
                              : status?.state === "loading" ? "#64748b" : "#94a3b8",
                          }}>
                          {status?.state === "loading" ? "… جارٍ الفحص"
                            : status?.state === "online" ? "✓ متصل"
                            : status?.state === "offline" ? "✗ غير متصل" : "غير معروف"}
                        </span>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {limited && !q && (
        <p className="mt-2 text-center text-xs font-semibold text-slate-400">
          تُعرض أوّل {subs.length.toLocaleString("en-US")} — استعمل البحث للوصول إلى الباقي
        </p>
      )}

      {/* نافذةُ العمليّات — غطاءٌ يمرّر وإجراءٌ ملتصقٌ بالأسفل */}
      {opsSub && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/50 p-3"
          onClick={() => { if (!sending) setOpsSub(null); }}>
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <h3 className="text-sm font-extrabold text-slate-800">🛠️ رفعُ طلبٍ للمشترك</h3>
              <button onClick={() => { if (!sending) setOpsSub(null); }}
                className="rounded-lg px-2 py-1 text-lg font-bold leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>

            <div className="px-4 py-3">
              <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-sm font-extrabold text-slate-800">{opsSub.name || "—"}</div>
                <div className="text-xs font-semibold text-slate-500" dir="ltr">{opsSub.netUser || "—"}</div>
              </div>

              <label className="mb-1 block text-xs font-extrabold text-slate-600">نوعُ الطلب</label>
              {opsLoading ? (
                <p className="py-3 text-center text-xs font-semibold text-slate-400">… جارٍ جلب الأنواع</p>
              ) : ops.length === 0 ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">لا أنواعَ متاحةً لمكتب هذا المشترك</p>
              ) : (
                <div className="mb-3 flex flex-wrap gap-2">
                  {ops.map((o) => (
                    <button key={o} onClick={() => setOp(o)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-extrabold ${
                        op === o ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}>{o}</button>
                  ))}
                </div>
              )}

              <label className="mb-1 block text-xs font-extrabold text-slate-600">هاتفٌ إضافيّ (اختياريّ)</label>
              <input value={extraPhone} onChange={(e) => setExtraPhone(e.target.value)} dir="ltr" inputMode="tel"
                className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />

              <label className="mb-1 block text-xs font-extrabold text-slate-600">ملاحظة (اختياريّة)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />

              {opsErr && <p className="mt-3 whitespace-pre-line rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{opsErr}</p>}
              {opsMsg && <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs font-bold text-green-700">{opsMsg}</p>}
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button onClick={submitOps} disabled={!op || sending}
                className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white disabled:bg-slate-300">
                {sending ? "… جارٍ الرفع" : "رفعُ الطلب"}
              </button>
              <button onClick={() => { if (!sending) setOpsSub(null); }}
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-extrabold text-slate-600">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
