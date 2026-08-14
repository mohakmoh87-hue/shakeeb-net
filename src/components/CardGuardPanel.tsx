"use client";
import { useEffect, useState } from "react";

// ═════════ 🛡️ حارسُ المال · لوحةُ الحالات **وإجراءاتُها** (طلبُ محمد 2026-08-14) ═════════
//
// «علاجُ الحالات الشاذّة يكون في **نفس الحارس** وليس مثلَ الآن فقط تجاهُل — فيوفّر
//  حارسُ المال إجراءاتٍ يمكن اتّخاذها منه مباشرةً.»
//
// فكلُّ صفٍّ يحمل حكمَه وسببَه وإجراءَه: استعادةٌ للمخزن · استعادةٌ مربوطةٌ بمشتركه ·
// تصحيحُ مدّة · إعادةُ فحص · «عُولجت» بملاحظة. ولا زرَّ **تجاهُلٍ أعمى**: كلُّ إغلاقٍ
// يُسجَّل بمن أغلقه وسببِه، فالحالةُ تُحسَم لا تُطمَس.

type Row = {
  id: number; serial: string | null; price: number | null; packageId: number | null;
  useDate: string | null; subscriberId: number | null; subName: string | null; subUser: string | null;
  deletedAt: string; deletedBy: string | null; reason: string | null; office: string | null;
  verdict: string; verdictAt: string | null; sasInfo: string | null;
  handledAction: string | null; handledAt: string | null; handledBy: string | null;
  handledNote: string | null; restoredCardId: number | null;
};

const VERDICT: Record<string, { t: string; c: string; why: string }> = {
  pending: { t: "قيدَ الفحص", c: "bg-slate-100 text-slate-700", why: "لم يُفحَص في الساس بعد — يُفحَص خلال دقائق" },
  normal: { t: "طبيعيّ", c: "bg-emerald-100 text-emerald-700", why: "مُفعَّلٌ في الساس ولمشتركه وصلُ قبض — لا شيءَ للعمل" },
  "no-receipt": { t: "🔴 بلا وصلِ قبض", c: "bg-rose-100 text-rose-700", why: "الكارتُ مُفعَّلٌ في الساس لمشتركك ولا وصلَ قبضٍ له — مالٌ لم يُسجَّل" },
  unsold: { t: "🔴 حُذف قبل استخدامه", c: "bg-rose-100 text-rose-700", why: "كارتٌ في المخزن حُذف وهو غيرُ مستخدَم — خسارةُ مخزون" },
  "bad-duration": { t: "⚠️ مدّةٌ مقلوبة", c: "bg-amber-100 text-amber-800", why: "المالُ مقبوضٌ والتفعيلُ ثابت، لكنّ الانتهاءَ أقدمُ من البداية — مشتركٌ دفع ولا مدّةَ له" },
  unverified: { t: "⚠️ لم يُثبَت في الساس", c: "bg-amber-100 text-amber-800", why: "لم يوجد في تفعيلات الساس — ولا يعني ذلك أنّه وهميّ: غيابُ الدليل ليس دليلَ غياب" },
  error: { t: "تعذّر الفحص", c: "bg-slate-200 text-slate-700", why: "لم يُمكن الوصولُ إلى الساس أو اللقطةُ ناقصة — أعِد الفحص" },
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default function CardGuardPanel() {
  const [view, setView] = useState<"open" | "all" | "handled">("open");
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [daysFor, setDaysFor] = useState<number | null>(null);
  const [daysText, setDaysText] = useState("31");

  async function load(v = view) {
    setLoading(true);
    try {
      const r = await fetch(`/api/manager/card-guard?view=${v}`, { cache: "no-store" });
      const j = await r.json();
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setPendingCount(j.pendingCount ?? 0);
    } catch { setRows([]); }
    setLoading(false);
  }
  useEffect(() => { void load("open"); }, []);

  async function act(id: number, action: string, extra: Record<string, unknown> = {}) {
    setBusy(id); setMsg(null);
    try {
      const r = await fetch("/api/manager/card-guard", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) setMsg(`⛔ ${j.error ?? "تعذّر الإجراء"}`);
      else if (j.already) setMsg("• الكارتُ موجودٌ سلفاً في المخزن — أُغلقت الحالةُ بلا تكرار");
      else if (action === "recheck") setMsg(`🔍 أُعيد الفحص: ${VERDICT[j.verdict as string]?.t ?? j.verdict}`);
      else if (j.cardId) setMsg(`✅ استُعيد الكارتُ برقم #${j.cardId}`);
      else setMsg("✅ سُجِّل الإجراء");
      setNoteFor(null); setNoteText(""); setDaysFor(null);
      await load();
    } catch { setMsg("⛔ خطأُ شبكة"); }
    setBusy(null);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-extrabold text-slate-800">🛡️ حارسُ المال — الكروتُ المحذوفة</div>
          <div className="text-[12px] text-slate-500">
            لا يُحذَف كارتٌ إلّا بلقطةٍ قبلَ حذفِه وفحصٍ في الساس فورَه. و«طبيعيّ» يمرّ صامتاً — وما عداه هنا بإجرائه.
            {pendingCount > 0 && <span className="ms-1 font-bold text-slate-700">· {pendingCount} قيدَ الفحص</span>}
          </div>
        </div>
        <div className="flex gap-1">
          {([["open", "تنتظر قراراً"], ["handled", "عُولجت"], ["all", "الكلّ"]] as [typeof view, string][]).map(([v, t]) => (
            <button key={v} onClick={() => { setView(v); void load(v); }}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold ${
                view === v ? "border-mynet-blue bg-mynet-blue text-white" : "border-slate-200 bg-white text-slate-600"}`}>{t}</button>
          ))}
        </div>
      </div>

      {msg && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-700">{msg}</div>}

      {loading ? <div className="py-6 text-center text-sm text-slate-400">جارٍ الجلب…</div>
       : rows.length === 0 ? (
        <div className="rounded-xl bg-emerald-50 py-6 text-center text-sm font-bold text-emerald-700">
          {view === "open" ? "✅ لا حالةَ تنتظر قراراً — كلُّ كارتٍ حُذف كان طبيعيّاً" : "لا صفوف"}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const v = VERDICT[r.verdict] ?? { t: r.verdict, c: "bg-slate-100 text-slate-700", why: "" };
            const done = r.handledAt != null;
            return (
              <div key={r.id} className={`rounded-xl border p-3 ${done ? "border-slate-200 bg-slate-50" : "border-rose-200 bg-white"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${v.c}`}>{v.t}</span>
                  <span className="font-mono text-[13px] font-bold text-slate-800">{r.serial ?? "بلا سيريال"}</span>
                  {r.price != null && <span className="text-[12px] font-bold text-slate-600">{r.price.toLocaleString("en-US")} د.ع</span>}
                  {r.subName && <span className="text-[12px] text-slate-600">· {r.subName} {r.subUser ? `(${r.subUser})` : ""}</span>}
                  {r.office && <span className="text-[11px] text-slate-400">· {r.office}</span>}
                  <span className="ms-auto text-[11px] text-slate-400">
                    حُذف {fmtDate(r.deletedAt)} · {r.deletedBy ?? "؟"} · {r.reason === "phantom" ? "الكروت الوهمية" : r.reason === "bulk" ? "حذفٌ جماعيّ" : "حذفٌ مفرد"}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-slate-600">{v.why}</div>
                {r.sasInfo && <div className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-mono text-slate-600">{r.sasInfo}</div>}

                {done ? (
                  <div className="mt-2 text-[12px] font-bold text-slate-600">
                    ✔ {r.handledAction === "restore-stock" ? "أُعيد للمخزن" : r.handledAction === "restore-linked" ? "أُعيد مربوطاً بمشتركه"
                       : r.handledAction === "fix-duration" ? "صُحّحت المدّة" : "عُولجت"}
                    {r.restoredCardId ? ` · كارت #${r.restoredCardId}` : ""} · {r.handledBy ?? "؟"} · {fmtDate(r.handledAt)}
                    {r.handledNote ? <div className="font-normal text-slate-500">{r.handledNote}</div> : null}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* الاستعادةُ المربوطةُ أوّلاً: هي إجراءُ الحذفِ الظالم — الكارتُ كان مبيعاً ومقبوضاً */}
                    {r.subscriberId != null && r.useDate && (
                      <button disabled={busy === r.id} onClick={() => act(r.id, "restore-linked")}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
                        ↩ أعِدْه مستخدَماً ومربوطاً بمشتركه
                      </button>
                    )}
                    <button disabled={busy === r.id} onClick={() => act(r.id, "restore-stock")}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12px] font-bold text-emerald-700 disabled:opacity-50">
                      📦 أعِدْه للمخزن
                    </button>
                    {r.verdict === "bad-duration" && (
                      daysFor === r.id ? (
                        <span className="flex items-center gap-1">
                          <input value={daysText} onChange={(e) => setDaysText(e.target.value)} inputMode="numeric"
                            className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-[12px]" placeholder="أيّام" />
                          <button disabled={busy === r.id} onClick={() => act(r.id, "fix-duration", { days: Number(daysText) })}
                            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">صحّح</button>
                          <button onClick={() => setDaysFor(null)} className="text-[12px] text-slate-500">إلغاء</button>
                        </span>
                      ) : (
                        <button onClick={() => { setDaysFor(r.id); setDaysText("31"); }}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-bold text-amber-800">
                          🗓️ صحّح المدّة
                        </button>
                      )
                    )}
                    <button disabled={busy === r.id} onClick={() => act(r.id, "recheck")}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 disabled:opacity-50">
                      🔍 أعِد الفحص
                    </button>
                    {noteFor === r.id ? (
                      <span className="flex items-center gap-1">
                        <input value={noteText} onChange={(e) => setNoteText(e.target.value)}
                          className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-[12px]" placeholder="سببُ الإغلاق (إلزاميّ)" />
                        <button disabled={busy === r.id || !noteText.trim()} onClick={() => act(r.id, "resolved", { note: noteText.trim() })}
                          className="rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">أغلِق</button>
                        <button onClick={() => setNoteFor(null)} className="text-[12px] text-slate-500">إلغاء</button>
                      </span>
                    ) : (
                      <button onClick={() => { setNoteFor(r.id); setNoteText(""); }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600">
                        ✔ عُولجت (بملاحظة)
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
