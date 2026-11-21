"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatExpiry, remaining, remainingText } from "@/lib/format";

// 👁️ لوحةُ مستخدم المشاهدة — صفحتُه الوحيدة (طلبُ محمد 2026-11-21).
// بحثٌ بالاسم أو اليوزر · حالةُ اتصالٍ بالضغط على الصفّ · وزرُّ عمليّاتٍ يرفع بطاقة.
// 🔴 ولا هاتفَ إطلاقاً: المسارُ لا يُرجعه أصلاً، فلا شيءَ يُخفى هنا بالعرض.
// و`SubscribersBoard` (١٣٧٠ سطراً فيه المالُ والتفعيلُ والحذف) لا علاقةَ له بهذا الملفّ.

type Sub = { id: number; name: string | null; netUser: string | null; towerId: number | null; dateTo: string | null };

// ⏰ أيّامُ المتبقّي بنفس قاعدة البرنامج حرفيّاً (`SubscribersBoard`): منتهٍ ⇒ سالبٌ
//    ناقصَ واحد، فلا فرقَ تقاويمَ بين منتصفَي ليلٍ يبتلع الوقتَ ولا إزاحةَ الساس.
const daysLeft = (dateTo: string | null) => {
  const r = remaining(dateTo);
  if (!r) return 0;
  return r.negative ? -r.days - 1 : r.days;
};
type Office = { id: number; name: string | null };
type Status = { id: number; state: "loading" | "online" | "offline" | "unknown" };
type Tech = { id: number; name: string };

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
  const [techs, setTechs] = useState<Tech[]>([]);
  const [techId, setTechId] = useState<number | "">("");

  // 🆕 نافذةُ البطاقة الحرّة (مشتركٌ غيرُ موجودٍ في القاعدة)
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeOffice, setFreeOffice] = useState<number | "">("");
  const [freeText, setFreeText] = useState("");

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

  // أنواعُ العمليّات وفنيّو المكتب — يُجلبان معاً لمكتبٍ واحد (نافذةُ المشترك أو الحرّة)
  const loadOfficeOptions = useCallback((officeId: number) => {
    setOps([]); setTechs([]); setTechId(""); setOpsLoading(true);
    Promise.all([
      fetch(`/api/watch/ops?officeId=${officeId}`).then((r) => (r.ok ? r.json() : { ops: [] })).catch(() => ({ ops: [] })),
      fetch(`/api/watch/technicians?officeId=${officeId}`).then((r) => (r.ok ? r.json() : { techs: [] })).catch(() => ({ techs: [] })),
    ])
      .then(([o, t]: [{ ops?: string[] }, { techs?: Tech[] }]) => { setOps(o.ops ?? []); setTechs(t.techs ?? []); })
      .finally(() => setOpsLoading(false));
  }, []);

  function openOps(s: Sub) {
    setOpsSub(s); setOp(""); setExtraPhone(""); setNote(""); setOpsMsg(""); setOpsErr("");
    loadOfficeOptions(s.towerId ?? 0);
  }

  function openFree() {
    setFreeOpen(true); setOp(""); setFreeText(""); setOpsMsg(""); setOpsErr("");
    // نطاقُ مكتبٍ واحد ⇒ مكتبُه هو، بلا اختيار. ونطاقُ كلّ المكاتب ⇒ يختار أوّلاً.
    const only = allOffices ? "" : offices[0]?.id ?? "";
    setFreeOffice(only === "" ? "" : Number(only));
    if (only !== "") loadOfficeOptions(Number(only));
    else { setOps([]); setTechs([]); setTechId(""); }
  }

  async function submitOps() {
    if (!opsSub || !op || sending) return;
    setSending(true); setOpsErr(""); setOpsMsg("");
    try {
      const r = await fetch("/api/watch/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberId: opsSub.id, operation: op, extraPhone, note, technicianId: techId === "" ? null : techId }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; listName?: string; error?: string } | null;
      if (!r.ok || !d?.ok) { setOpsErr(d?.error ?? "تعذّر رفع الطلب"); return; }
      setOpsMsg(`✅ رُفع الطلب في عمود «${d.listName}»`);
      setOp(""); setExtraPhone(""); setNote(""); setTechId("");
    } catch {
      setOpsErr("تعذّر الاتّصال — حاول مرّةً أخرى");
    } finally {
      setSending(false);
    }
  }

  async function submitFree() {
    if (!op || !freeText.trim() || sending) return;
    if (allOffices && freeOffice === "") { setOpsErr("اختر المكتب أوّلاً"); return; }
    setSending(true); setOpsErr(""); setOpsMsg("");
    try {
      const r = await fetch("/api/watch/free-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officeId: freeOffice === "" ? null : freeOffice,
          operation: op, text: freeText,
          technicianId: techId === "" ? null : techId,
        }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; listName?: string; error?: string } | null;
      if (!r.ok || !d?.ok) { setOpsErr(d?.error ?? "تعذّر رفع البطاقة"); return; }
      setOpsMsg(`✅ رُفعت البطاقة في عمود «${d.listName}»`);
      setFreeText(""); setOp(""); setTechId("");
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
        {/* 🆕 بطاقةٌ حرّةٌ لمشتركٍ غيرِ موجودٍ في القاعدة (طلبُ محمد 2026-11-21) */}
        <button onClick={openFree}
          className="shrink-0 rounded-xl bg-sky-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-sky-700">
          ➕ بطاقةٌ جديدة
        </button>
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
        <div className="max-h-[70dvh] overflow-auto">
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
                    <td className="break-words px-3 py-2 font-bold text-slate-800">{s.name || "—"}</td>
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
                        <div className="flex flex-wrap items-center gap-2">
                        {/* ⏰ «المتبقي» يومٌ وساعةٌ ودقيقة — نفسُ صيغة البرنامج وتلوينِه
                            (أحمرُ للمنتهي · أخضرُ لما فوق سبعةِ أيّام · كهرمانيٌّ لما دونها)،
                            والعنوانُ يُظهر تاريخَ الانتهاء كما يعرضه الساس. طلبُ محمد 2026-11-21. */}
                        {(() => {
                          const d = daysLeft(s.dateTo);
                          // بلا تاريخِ انتهاءٍ ⇒ رماديٌّ محايد: الكهرمانيُّ تحذيرٌ، ولا شيءَ هنا يُحذَّر منه
                          const tone = !s.dateTo ? "bg-slate-400" : d < 0 ? "bg-red-600" : d > 7 ? "bg-green-600" : "bg-amber-500";
                          return (
                            <span className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-extrabold text-white ${tone}`}
                              title={`ينتهي: ${formatExpiry(s.dateTo)}`}>
                              المتبقي <b>{remainingText(s.dateTo)}</b>
                            </span>
                          );
                        })()}
                        <span className="whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-extrabold text-white"
                          style={{
                            background: status?.state === "online" ? "#16a34a"
                              : status?.state === "offline" ? "#dc2626"
                              : status?.state === "loading" ? "#64748b" : "#94a3b8",
                          }}>
                          {status?.state === "loading" ? "… جارٍ الفحص"
                            : status?.state === "online" ? "✓ متصل"
                            : status?.state === "offline" ? "✗ غير متصل" : "غير معروف"}
                        </span>
                        </div>
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

              <label className="mb-1 block text-xs font-extrabold text-slate-600">الفنيّ (اختياريّ)</label>
              <select value={techId} onChange={(e) => setTechId(e.target.value === "" ? "" : Number(e.target.value))}
                className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500">
                <option value="">— بلا فنيّ (يوزّعه المكتب) —</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

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

      {/* 🆕 نافذةُ البطاقة الحرّة — مشتركٌ غيرُ موجودٍ في القاعدة (تنصيبٌ جديد) */}
      {freeOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/50 p-3"
          onClick={() => { if (!sending) setFreeOpen(false); }}>
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <h3 className="text-sm font-extrabold text-slate-800">➕ بطاقةٌ جديدة</h3>
              <button onClick={() => { if (!sending) setFreeOpen(false); }}
                className="rounded-lg px-2 py-1 text-lg font-bold leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>

            <div className="px-4 py-3">
              <p className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-[11px] font-semibold leading-5 text-sky-800">
                لمشتركٍ <b>غيرِ موجودٍ في النظام</b> — تنصيبٌ جديدٍ مثلاً. اكتب ما تشاء:
                الاسمَ والعنوانَ ورقمَ الهاتف وأيَّ تفصيلٍ يحتاجه الفنيّ.
              </p>

              {allOffices && (
                <>
                  <label className="mb-1 block text-xs font-extrabold text-slate-600">المكتب</label>
                  <select value={freeOffice}
                    onChange={(e) => {
                      const v = e.target.value === "" ? "" : Number(e.target.value);
                      setFreeOffice(v); setOp("");
                      if (v !== "") loadOfficeOptions(Number(v));
                    }}
                    className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500">
                    <option value="">— اختر المكتب —</option>
                    {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
                  </select>
                </>
              )}

              <label className="mb-1 block text-xs font-extrabold text-slate-600">نوعُ البطاقة</label>
              {opsLoading ? (
                <p className="py-3 text-center text-xs font-semibold text-slate-400">… جارٍ جلب الأنواع</p>
              ) : ops.length === 0 ? (
                <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  {allOffices && freeOffice === "" ? "اختر المكتبَ أوّلاً" : "لا أنواعَ متاحةً لهذا المكتب"}
                </p>
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

              <label className="mb-1 block text-xs font-extrabold text-slate-600">الفنيّ (اختياريّ)</label>
              <select value={techId} onChange={(e) => setTechId(e.target.value === "" ? "" : Number(e.target.value))}
                className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500">
                <option value="">— بلا فنيّ (يوزّعه المكتب) —</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

              <label className="mb-1 block text-xs font-extrabold text-slate-600">التفاصيل</label>
              <textarea value={freeText} onChange={(e) => setFreeText(e.target.value)} rows={5}
                placeholder="الاسم · العنوان · رقم الهاتف · أيُّ تفصيل…"
                className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-sky-500" />

              {opsErr && <p className="mt-3 whitespace-pre-line rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{opsErr}</p>}
              {opsMsg && <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs font-bold text-green-700">{opsMsg}</p>}
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button onClick={submitFree} disabled={!op || !freeText.trim() || sending}
                className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-extrabold text-white disabled:bg-slate-300">
                {sending ? "… جارٍ الرفع" : "رفعُ البطاقة"}
              </button>
              <button onClick={() => { if (!sending) setFreeOpen(false); }}
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-extrabold text-slate-600">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
