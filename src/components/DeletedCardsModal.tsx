"use client";

import { useCallback, useEffect, useState } from "react";

// ===== سلّة محذوفات البطاقات (طلب محمد 2026-08-05) =====
// الحذف ناعمٌ في القاعدة منذ زمن، لكن بلا شاشة تعرضه — فضغطةٌ خاطئة كانت تعني
// ضياعاً نهائياً في نظر المستخدم. هنا تُرى وتُسترجَع إلى عمودها الأصلي.
type Row = {
  id: number; title: string; kind: string; assignee: string | null;
  listName: string | null; listGone: boolean; office: string | null;
  done: boolean; settled: boolean; backToSettlement: number;
  deletedAt: string; createdAt: string;
};

const fmtDT = (d: string) =>
  new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function DeletedCardsModal({ officeId, officeName, onClose, onChange }: {
  officeId: number | null; officeName: string; onClose: () => void; onChange: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/field/cards/deleted${officeId != null ? `?officeId=${officeId}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setRows(d?.rows ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [officeId]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  async function restore(r: Row) {
    const extra = r.backToSettlement > 0
      ? `\n\n⚠️ هي منجزة ولم تُحصَّل — سيعود ${r.backToSettlement.toLocaleString("en-US")} د.ع إلى تحصيل ${r.assignee ?? "الفني"}.`
      : "";
    if (!confirm(`استرجاع «${r.title}» إلى عمود «${r.listName ?? "—"}»؟${extra}\n\nملاحظة: صور البطاقة لا تعود (مُحيت عند الحذف).`)) return;
    setBusy(r.id); setMsg("");
    const res = await fetch("/api/field/cards/deleted", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setMsg(d.error ?? "تعذّر الاسترجاع"); return; }
    setMsg(`✓ عادت «${r.title}» إلى عمود «${d.listName ?? r.listName}»`);
    load();
    onChange();
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🗑️ البطاقات المحذوفة</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>
        <div className="mb-3 text-xs text-slate-500">{officeName} · تُسترجَع إلى عمودها الأصلي — وصورها لا تعود.</div>

        {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">جاري التحميل…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">لا بطاقات محذوفة</div>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-slate-800">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">{r.kind}</span>
                      {r.listName && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">عمود: {r.listName}</span>}
                      {r.assignee && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">👤 {r.assignee}</span>}
                      {r.done && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">كانت منجزة</span>}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">حُذفت: <span dir="ltr">{fmtDT(r.deletedAt)}</span></div>
                    {r.backToSettlement > 0 && (
                      <div className="mt-1 text-[11px] font-semibold text-amber-700">
                        يعود لتحصيل الفني: {r.backToSettlement.toLocaleString("en-US")} د.ع
                      </div>
                    )}
                  </div>
                  {r.listGone ? (
                    <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-400">عمودها محذوف</span>
                  ) : (
                    <button onClick={() => restore(r)} disabled={busy === r.id}
                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                      {busy === r.id ? "…" : "♻️ استرجاع"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
