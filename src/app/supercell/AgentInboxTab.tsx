"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type InboxCard = { id: number; note: string | null; agentId: number | null; type: string | null; status: string; reply: string | null; repliedAt: string | null; createdAt: string; source?: string };

const ST_LABEL: Record<string, string> = { new: "جديدة", contacted: "قيد المعالجة", done: "مغلقة", rejected: "مرفوضة" };
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ar", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AgentInboxTab({ isManager }: { isManager: boolean }) {
  const [cards, setCards] = useState<InboxCard[]>([]);
  const [agentName, setAgentName] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "new" | "work" | "closed">("all");
  const [q, setQ] = useState("");
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [editCats, setEditCats] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [newCat, setNewCat] = useState("");
  const [catMsg, setCatMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/company/tickets").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setCards((d.tickets || []).filter((t: InboxCard) => t.source === "agent-inbox")); setAgentName(d.agentName || {}); }
    }).catch(() => {});
  }, []);
  const loadCats = useCallback(() => {
    fetch("/api/company/card-config").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setCats(d.agentCategories || []); }).catch(() => {});
  }, []);
  useEffect(() => { load(); loadCats(); const iv = setInterval(load, 20_000); return () => clearInterval(iv); }, [load, loadCats]);

  async function sendReply(id: number) {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    try {
      const r = await fetch("/api/company/tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reply: replyText }) });
      if (!r.ok) { alert("فشل إرسال الردّ — حاول ثانيةً"); return; }
      setReplyFor(null); setReplyText(""); load();
    } finally { setReplySending(false); }
  }
  async function setStatus(id: number, status: string) {
    await fetch("/api/company/tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    load();
  }
  async function saveCats() {
    setCatMsg("");
    if (cats.length === 0) { setCatMsg("أضِف فئةً واحدةً على الأقل"); return; }
    const r = await fetch("/api/company/card-config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentCategories: cats }) });
    if (r.ok) { setCatMsg("✓ حُفِظ"); loadCats(); } else setCatMsg("فشل الحفظ");
  }

  const shown = useMemo(() => {
    let a = cards;
    if (filter === "new") a = a.filter((c) => c.status === "new");
    else if (filter === "work") a = a.filter((c) => c.status === "contacted");
    else if (filter === "closed") a = a.filter((c) => c.status === "done");
    const qq = q.trim();
    if (qq) a = a.filter((c) => (agentName[String(c.agentId)] || "").includes(qq) || (c.note || "").includes(qq) || (c.type || "").includes(qq));
    return a;
  }, [cards, filter, q, agentName]);

  const cNew = cards.filter((c) => c.status === "new").length;
  const cWork = cards.filter((c) => c.status === "contacted").length;
  const cClosed = cards.filter((c) => c.status === "done").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {([["🆕", "جديدة", cNew, cNew > 0 ? "amber" : "slate"], ["⏳", "قيد المعالجة", cWork, "slate"], ["✅", "مغلقة", cClosed, "emerald"]] as const).map(([ic, lb, v, tone]) => (
          <div key={lb} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-lg">{ic}</span>
              <span className={`text-2xl font-extrabold ${tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-800"}`} dir="ltr">{v.toLocaleString("en-US")}</span>
            </div>
            <div className="mt-1 text-[11px] font-semibold text-slate-500">{lb}</div>
          </div>
        ))}
      </div>

      {/* فئاتُ الوارد (للمدير) */}
      {isManager && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <button onClick={() => setEditCats((v) => !v)} className="text-sm font-bold text-slate-700">{editCats ? "▼" : "◀"} 🏷️ فئاتُ بطاقات الوكلاء (يرفعها الوكلاءُ إليك)</button>
          {editCats && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{c}
                    <button onClick={() => setCats(cats.filter((x) => x !== c))} className="text-rose-500 hover:text-rose-700">✕</button>
                  </span>
                ))}
                {cats.length === 0 && <span className="text-xs text-slate-400">لا فئات — أضِف واحدة.</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newCat.trim()) { setCats([...new Set([...cats, newCat.trim()])]); setNewCat(""); } }} placeholder="فئةٌ جديدة" className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                <button onClick={() => { if (newCat.trim()) { setCats([...new Set([...cats, newCat.trim()])]); setNewCat(""); } }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">+ إضافة</button>
                <button onClick={() => void saveCats()} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">حفظ</button>
                {catMsg && <span className="text-xs text-slate-600">{catMsg}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-extrabold text-slate-800">📥 وارد الوكلاء</div>
            <div className="text-[11px] text-slate-500">بطاقاتٌ يرفعها الوكلاءُ إليك — المعروض {shown.length}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 وكيل أو موضوع…" className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-bold">
              {([["all", "الكل"], ["new", "جديدة"], ["work", "قيد المعالجة"], ["closed", "مغلقة"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-2.5 py-1 transition ${filter === k ? "bg-[#16213e] text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">لا بطاقات</div>
        ) : (
          <div className="space-y-2">
            {shown.map((c) => {
              const closed = c.status === "done";
              return (
                <div key={c.id} className={`rounded-xl border border-slate-100 bg-slate-50/70 p-3 ${closed ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[#16213e] px-1.5 py-0.5 text-[10px] font-bold text-white">🏢 {agentName[String(c.agentId)] ?? (c.agentId != null ? `وكيل ${c.agentId}` : "—")}</span>
                      {c.type && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{c.type}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400">{fmtDate(c.createdAt)}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${closed ? "bg-emerald-100 text-emerald-700" : c.status === "contacted" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{ST_LABEL[c.status] ?? c.status}</span>
                    </div>
                  </div>
                  {c.note && <div className="mt-1.5 text-sm text-slate-700">{c.note}</div>}
                  {c.reply && <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-[12px] text-emerald-800"><span className="font-bold">ردُّك:</span> {c.reply}{c.repliedAt && <span className="mr-1 text-[10px] text-emerald-600"> · {fmtDate(c.repliedAt)}</span>}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {replyFor === c.id ? (
                      <>
                        <input value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sendReply(c.id); }} autoFocus placeholder="اكتب ردَّك…" className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                        <button onClick={() => void sendReply(c.id)} disabled={!replyText.trim() || replySending} className="rounded bg-[#16213e] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#26375f] disabled:opacity-50">{replySending ? "..." : "إرسال"}</button>
                        <button onClick={() => { setReplyFor(null); setReplyText(""); }} className="rounded bg-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-600">إلغاء</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setReplyFor(c.id); setReplyText(c.reply ?? ""); }} className="rounded bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-200">↩ {c.reply ? "تعديل الردّ" : "ردّ"}</button>
                        {c.status !== "contacted" && !closed && <button onClick={() => void setStatus(c.id, "contacted")} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">قيد المعالجة</button>}
                        {!closed && <button onClick={() => void setStatus(c.id, "done")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200">✓ إغلاق</button>}
                        {closed && <button onClick={() => void setStatus(c.id, "contacted")} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">↩ إعادة فتح</button>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
