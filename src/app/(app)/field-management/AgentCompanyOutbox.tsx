"use client";

import { useCallback, useEffect, useState } from "react";

type Card = { id: number; type: string | null; note: string | null; status: string; reply: string | null; repliedAt: string | null; createdAt: string };
const ST: Record<string, string> = { new: "جديدة", contacted: "قيد المعالجة", done: "مغلقة", rejected: "مرفوضة" };
function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ar", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// جانبُ الوكيل من «وارد الوكلاء»: يرفع بطاقةً لسوبر سيل ويرى ردَّها وحالتَها. زرٌّ في ترويسة
// إدارة الفنيين (لصاحب صلاحية field.manage فقط) يفتح نافذةً.
export default function AgentCompanyOutbox({ canManage }: { canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [enabled, setEnabled] = useState(false); // يُعرَف من الخادم؛ يبقى مخفيّاً حتى يتأكّد أنّ سوبر سيل مفعّلة

  const load = useCallback(() => {
    fetch("/api/field/agent-cards").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setEnabled(d.enabled !== false); setCards(d.cards || []); setCats(d.categories || []); setCategory((c) => (d.categories?.includes(c) ? c : d.categories?.[0] || "")); }
    }).catch(() => {});
  }, []);
  // على الإقلاع نعرف إن كانت سوبر سيل مفعّلةً (فيظهر الزرُّ أو يختفي كأنّه لا وجودَ له) — للمدير فقط
  useEffect(() => { if (canManage) load(); }, [canManage, load]);
  useEffect(() => {
    if (!open) return;
    load();
    const iv = setInterval(load, 20_000); // ردُّ الشركة يظهر بلا إعادة فتح
    return () => clearInterval(iv);
  }, [open, load]);

  async function send() {
    if (!category || !subject.trim()) { setMsg("اختر الفئة واكتب الموضوع"); return; }
    setSending(true); setMsg("");
    try {
      const r = await fetch("/api/field/agent-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, subject }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? "فشل الإرسال"); return; }
      setMsg("✓ أُرسلت للشركة"); setSubject(""); load();
    } catch { setMsg("تعذّر الاتصال"); } finally { setSending(false); }
  }

  if (!canManage || !enabled) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-trial-hide
        className="rounded-lg bg-[#16213e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#26375f]">📤 راسل سوبر سيل</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div dir="rtl" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-extrabold text-slate-800">📤 مراسلةُ سوبر سيل</div>
              <button onClick={() => setOpen(false)} className="rounded-lg bg-slate-100 px-2 py-1 text-sm text-slate-500 hover:bg-slate-200">✕</button>
            </div>

            {/* نموذجُ الرفع */}
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">الفئة
                  <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={cats.length === 0} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
                    {cats.length === 0 ? <option value="">لا فئاتٌ بعد — تُضيفها الشركة</option> : cats.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="mt-2 block text-xs font-semibold text-slate-600">الموضوع
                <textarea value={subject} onChange={(e) => setSubject(e.target.value)} rows={2} placeholder="اكتب موضوعَ البطاقة للشركة…" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <div className="mt-2 flex items-center gap-3">
                <button onClick={() => void send()} disabled={sending || !category || !subject.trim()} className="rounded-lg bg-[#16213e] px-5 py-2 text-sm font-semibold text-white hover:bg-[#26375f] disabled:opacity-50">{sending ? "..." : "📤 إرسال"}</button>
                {msg && <span className="text-xs text-slate-600">{msg}</span>}
              </div>
            </div>

            {/* مراسلاتي وردودها */}
            <div className="mt-3">
              <div className="mb-1 text-sm font-bold text-slate-700">مراسلاتي ({cards.length})</div>
              {cards.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">لا مراسلات بعد.</div>
              ) : (
                <div className="space-y-2">
                  {cards.map((c) => (
                    <div key={c.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{c.type ?? "—"}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">{fmt(c.createdAt)}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${c.status === "done" ? "bg-emerald-100 text-emerald-700" : c.status === "contacted" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{ST[c.status] ?? c.status}</span>
                        </div>
                      </div>
                      {c.note && <div className="mt-1 text-[13px] text-slate-700">{c.note}</div>}
                      {c.reply && <div className="mt-1.5 rounded-lg bg-emerald-50 p-2 text-[12px] text-emerald-800"><span className="font-bold">ردُّ الشركة:</span> {c.reply}{fmt(c.repliedAt) && <span className="mr-1 text-[10px] text-emerald-600"> · {fmt(c.repliedAt)}</span>}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
