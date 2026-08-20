"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/format";

// ═════ 📋 نافذة «سجلّ المزامنة» الموحَّدة (مواصفة محمد 2026-08-20) ═════
// منبثقةٌ منتصفَ الشاشة بالضبط، 80% من حجمها، لا تُغلق إلّا بـX. أربعةُ تبويبات، وفي
// كلٍّ: ترتيبٌ تصاعديّ/تنازليّ لكلّ الأعمدة + بحثٌ بتاريخٍ أو بين تاريخين + بحثٌ نصّيّ
// (اسم · هاتف · باقة · يوزر · كلمة). العرضُ للجميع، والأزرارُ لصاحب صلاحيّة
// «تحديث سجل المزامنة» وحدَه (canEdit من الخادم — والخادمُ يحرسها حكماً).

type Change = { f: string; label: string; old: string; new: string };
type Row = {
  id: number; kind: "info" | "install" | "self" | "sas"; towerId: number; towerName: string;
  subscriberId: number | null; sasId: number | null; netUser: string | null; name: string | null;
  phone: string | null; address: string | null; packageName: string | null;
  sasDateTo: string | null; amount: number | null; activatedAt: string | null;
  changes: Change[] | null; createdAt: string;
  oursPhone: string | null; oursPackage: string | null; oursPrice: number | null; oursDateTo: string | null;
  oursSasId: number | null;
};

// تنصيبٌ على يوزرِ تاركِ خدمة (حسابُ ساسٍ جديدٌ على يوزرٍ قائم) ⇒ «تحديث» يستبدل المشتركَ
// كخاصيّة «↔️ استبدال المشترك» نفسِها (قرار محمد 2026-08-21) — فالزرُّ يقول ذلك بمسمّاه
const isReplaceRow = (r: Row) => r.kind === "install" && r.subscriberId != null && r.sasId != null && r.oursSasId !== r.sasId;

const KINDS = [
  { key: "info", label: "تحديث معلومات", icon: "📝" },
  { key: "install", label: "تنصيب خارجي", icon: "🏗️" },
  { key: "self", label: "تفعيل خارجي", icon: "📲" },
  { key: "sas", label: "تفعيلات ساس", icon: "🧾" },
] as const;
type Kind = (typeof KINDS)[number]["key"];

const num = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// رأسُ عمودٍ قابلٌ للترتيب (خارج المكوّن كي لا يُعاد إنشاؤه كلَّ رسم)
type SortCtl = { key: string; asc: boolean; by: (k: string) => void };
function Th({ k, s, children }: { k: string; s: SortCtl; children: React.ReactNode }) {
  return (
    <th onClick={() => s.by(k)} className="cursor-pointer select-none whitespace-nowrap p-2 text-right text-[12px] font-bold text-slate-500 hover:text-mynet-blue">
      {children} {s.key === k ? (s.asc ? "↑" : "↓") : "⇅"}
    </th>
  );
}

export default function SyncLogModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  // ⚠️ الشارةُ «عرضٌ فقط» لا تُعرَض إلّا بعد جوابِ الخادم الصريح (بلاغ محمد 2026-08-21:
  // ظهرت لمديرٍ كامل الصلاحيّة — والسببُ أنّ canEdit يبدأ false وفشلُ الجلب/بطؤه أثناء
  // نشرةٍ كان يُثبّتها ظلماً). فشلُ الجلب خطأُ اتصالٍ يُقال بمسمّاه لا نقصُ صلاحيّة.
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [tab, setTab] = useState<Kind>("info");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<string>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [plusFor, setPlusFor] = useState<number | null>(null); // قائمة «+» المفتوحة (تبويب ٤)
  // جيك بوكسا «إرسال رسائل تلقائي» (تبويبا ٢ و٣) — الافتراضيُّ إيقافُ الاثنين (قرار محمد)
  const [autoMsg, setAutoMsg] = useState<{ self: boolean; install: boolean }>({ self: false, install: false });

  // (لا setState متزامنة هنا — الحالةُ تبدأ "loading" أصلاً، وزرُّ الإعادة يعيدها بنفسه)
  const load = useCallback(() => {
    fetch("/api/sync-log")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setRows(Array.isArray(d.rows) ? d.rows : []); setCanEdit(d.canEdit === true);
          if (d.autoMsg) setAutoMsg({ self: d.autoMsg.self === true, install: d.autoMsg.install === true });
          setLoadState("ok");
        } else setLoadState("error");
      })
      .catch(() => setLoadState("error"));
  }, []);
  useEffect(() => { load(); }, [load]);

  // حفظُ جيك بوكس التبويب الحاليّ (يظهر للجميع، والتبديلُ لصاحب الصلاحيّة — والخادمُ يحرسه)
  async function toggleAuto(kind: "self" | "install", on: boolean) {
    setAutoMsg((v) => ({ ...v, [kind]: on })); // تفاؤليّاً — ويُسترجع من الخادم عند الفشل
    try {
      const r = await fetch("/api/sync-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autoMsg", kind, on }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.autoMsg) setAutoMsg({ self: d.autoMsg.self === true, install: d.autoMsg.install === true });
      else { setAutoMsg((v) => ({ ...v, [kind]: !on })); setMsg(d.error ?? "تعذّر حفظ الخيار"); }
    } catch { setAutoMsg((v) => ({ ...v, [kind]: !on })); setMsg("تعذّر الاتصال بالخادم"); }
  }

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { info: 0, install: 0, self: 0, sas: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);

  // التصفية: نصّيّاً (اسم/هاتف/باقة/يوزر/كلمة) وبالتاريخ (يومٌ محدَّد أو بين تاريخين)
  const view = useMemo(() => {
    const needle = q.trim();
    let list = rows.filter((r) => r.kind === tab);
    if (needle) {
      list = list.filter((r) =>
        [r.name, r.netUser, r.phone, r.packageName, r.address, r.towerName, r.oursPackage]
          .some((v) => (v ?? "").includes(needle)));
    }
    const dateOf = (r: Row) => (r.activatedAt ?? r.createdAt).slice(0, 10);
    if (from && to) list = list.filter((r) => dateOf(r) >= from && dateOf(r) <= to);
    else if (from) list = list.filter((r) => dateOf(r) === from);
    const dir = sortAsc ? 1 : -1;
    const val = (r: Row): string | number => {
      switch (sortKey) {
        case "name": return r.name ?? "";
        case "netUser": return r.netUser ?? "";
        case "phone": return r.phone ?? r.oursPhone ?? "";
        case "packageName": return r.packageName ?? "";
        case "tower": return r.towerName;
        case "amount": return r.amount ?? 0;
        default: return r.activatedAt ?? r.createdAt;
      }
    };
    return [...list].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
  }, [rows, tab, q, from, to, sortKey, sortAsc]);

  function sortBy(k: string) {
    if (sortKey === k) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  }

  async function act(ids: number[], action: "apply" | "ignore" | "activate" | "debt" | "message") {
    if (!ids.length || busy) return;
    setBusy(true); setMsg(""); setPlusFor(null);
    try {
      const r = await fetch("/api/sync-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setMsg(d.error ?? "تعذّر التنفيذ"); return; }
      const rej = (d.rejected ?? []) as string[];
      setMsg(`✓ نُفّذ ${d.done ?? 0}${rej.length ? ` — ورُفض ${rej.length}: ${rej.join(" · ")}` : ""}`);
      setSel(new Set());
      load();
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  const allSel = view.length > 0 && view.every((r) => sel.has(r.id));
  const srt: SortCtl = { key: sortKey, asc: sortAsc, by: sortBy };

  return (
    // ⚠️ لا إغلاقَ بالنقر على الفراغ — بعلامة ✕ حصراً (شرط محمد الثابت)
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60">
      {/* 📱 على الهاتف 80% تقصّ التبويبات (بلاغ محمد 2026-08-20) ⇒ شبهُ كاملةٍ هناك، و80% من md فصاعداً */}
      <div className="flex h-[92vh] w-[96vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:h-[80vh] md:w-[80vw]">
        {/* الرأس + X */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <h3 className="text-lg font-extrabold text-slate-800">🔄 سجلّ المزامنة</h3>
          {loadState === "ok" && !canEdit && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">عرضٌ فقط — التعديل لصلاحيّة «تحديث سجل المزامنة»</span>}
          {loadState === "error" && (
            <span className="flex items-center gap-2 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">
              تعذّر جلب السجلّ — ليست مشكلةَ صلاحيّة
              <button onClick={() => { setLoadState("loading"); load(); }} className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">إعادة المحاولة</button>
            </span>
          )}
          <button onClick={onClose} aria-label="إغلاق" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-slate-500 shadow-sm hover:bg-slate-200">✕</button>
        </div>

        {/* التبويبات */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 pt-2 md:px-4">
          {KINDS.map((k) => (
            <button key={k.key} onClick={() => { setTab(k.key); setSel(new Set()); setMsg(""); setPlusFor(null); }}
              className={`shrink-0 whitespace-nowrap rounded-t-xl px-2.5 py-2 text-[13px] font-bold md:px-4 md:text-sm ${tab === k.key ? "border border-b-0 border-slate-200 bg-white text-mynet-blue" : "text-slate-500 hover:text-slate-700"}`}>
              {k.icon} {k.label}{counts[k.key] > 0 && <span className={`mr-1.5 rounded-full px-1.5 text-[11px] font-extrabold ${tab === k.key ? "bg-mynet-blue text-white" : "bg-slate-200 text-slate-600"}`}>{counts[k.key]}</span>}
            </button>
          ))}
        </div>

        {/* البحث والتصفية */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          {/* جيك بوكس أعلى تبويبَي ٢ و٣ (طلب محمد): صحٌّ ⇒ رسالةُ القالب تلقائيّاً لحظةَ
              الرصد، وبلا صحٍّ ⇒ تحديدٌ يدويٌّ وزرُّ الإرسال. الافتراضيُّ: غيرُ مفعَّل. */}
          {(tab === "install" || tab === "self") && (
            <label className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-bold ${autoMsg[tab] ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"} ${canEdit ? "cursor-pointer" : "opacity-60"}`}
              title={`قالب «${tab === "install" ? "تنصيبات خارجية" : "تفعيلات خارجية"}» — يُعدَّل من صفحة قوالب الرسائل`}>
              <input type="checkbox" className="h-4 w-4" checked={autoMsg[tab]} disabled={!canEdit || busy}
                onChange={(e) => void toggleAuto(tab, e.target.checked)} />
              إرسال رسائل تلقائي
            </label>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث: اسم · هاتف · باقة · يوزر · كلمة"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-mynet-blue" />
          <label className="flex items-center gap-1 text-[12px] text-slate-500">من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[150px] rounded-lg border border-slate-300 px-2 py-1 text-sm" /></label>
          <label className="flex items-center gap-1 text-[12px] text-slate-500">إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[150px] rounded-lg border border-slate-300 px-2 py-1 text-sm" /></label>
          {(from || to || q) && <button onClick={() => { setQ(""); setFrom(""); setTo(""); }} className="text-[12px] text-slate-400 hover:text-slate-600">مسح ✕</button>}
          {canEdit && tab === "info" && (
            <>
              <div className="flex-1" />
              <button onClick={() => void act([...sel], "apply")} disabled={busy || sel.size === 0}
                className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">✔ تحديث المحدَّد ({sel.size})</button>
              <button onClick={() => void act([...sel], "ignore")} disabled={busy || sel.size === 0}
                className="rounded-lg bg-slate-500 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-slate-600 disabled:opacity-50">✖ تجاهل المحدَّد</button>
            </>
          )}
          {/* الإرسالُ اليدويّ (بلا صحِّ التلقائيّ أو فوقه): تحديدُ واحدٍ أو مجموعةٍ ثمّ إرسال */}
          {canEdit && (tab === "install" || tab === "self") && (
            <>
              <div className="flex-1" />
              <button onClick={() => void act([...sel], "message")} disabled={busy || sel.size === 0}
                className="rounded-lg bg-mynet-blue px-3.5 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">📨 إرسال رسالة للمحدَّد ({sel.size})</button>
            </>
          )}
        </div>
        {msg && <div className={`mx-4 mt-2 rounded-lg px-3 py-1.5 text-sm ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}

        {/* الجدول */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {view.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">
              {loadState === "loading" ? "جارٍ جلبُ السجلّ…"
                : loadState === "error" ? "تعذّر الاتصال بالخادم — اضغط «إعادة المحاولة» في الأعلى"
                : <>لا سطورَ في هذا التبويب {q || from ? "(بهذه التصفية)" : "— كلُّ شيءٍ معالَج ✓"}</>}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white shadow-sm">
                <tr>
                  {tab !== "sas" && canEdit && (
                    <th className="p-2"><input type="checkbox" checked={allSel} title="الكل"
                      onChange={() => setSel(allSel ? new Set() : new Set(view.map((r) => r.id)))} /></th>
                  )}
                  <Th k="name" s={srt}>الاسم</Th>
                  <Th k="netUser" s={srt}>اليوزر</Th>
                  {tab === "info" ? <th className="p-2 text-right text-[12px] font-bold text-slate-500">التغييرات (القديم ← الجديد)</th> : (
                    <>
                      <Th k="phone" s={srt}>الهاتف</Th>
                      <Th k="packageName" s={srt}>الباقة</Th>
                    </>
                  )}
                  {(tab === "self" || tab === "sas") && <Th k="amount" s={srt}>مبلغ الساس</Th>}
                  <Th k="createdAt" s={srt}>{tab === "self" || tab === "sas" ? "وقت التفعيلة" : "رُصد في"}</Th>
                  <Th k="tower" s={srt}>المكتب</Th>
                  {canEdit && tab !== "info" && <th className="p-2 text-right text-[12px] font-bold text-slate-500">إجراء</th>}
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                    {tab !== "sas" && canEdit && (
                      <td className="p-2 text-center"><input type="checkbox" checked={sel.has(r.id)}
                        onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                    )}
                    <td className="max-w-[220px] truncate p-2 font-semibold text-slate-800">
                      {r.name ?? "—"}
                      {r.subscriberId == null && <span className="mr-1 rounded bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700">جديد</span>}
                      {isReplaceRow(r) && <span className="mr-1 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700" title="تنصيبٌ على يوزر مشتركٍ تاركٍ للخدمة — التحديث يستبدله كاملاً والقديم يبقى أرشيفاً بدينه">يوزر معاد</span>}
                    </td>
                    <td className="p-2 text-slate-600" dir="ltr">{r.netUser ?? "—"}</td>
                    {tab === "info" ? (
                      <td className="p-2">
                        {/* 🔴 تغيّرُ اليوزر أخطرُ التغييرات (طلب محمد: «باللون الأحمر») —
                            سطرُه كلُّه أحمرُ عريضٌ داخل إطارٍ يميّزه عن بقيّة الفروق */}
                        {(r.changes ?? []).map((c, i) => (
                          c.f === "netUser" ? (
                            <div key={i} className="my-0.5 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[12px] font-extrabold leading-6 text-red-700">
                              {c.label}:{" "}
                              <span className="line-through opacity-70" dir="ltr">{c.old}</span>{" "}←{" "}
                              <span dir="ltr">{c.new}</span>
                            </div>
                          ) : (
                            <div key={i} className="text-[12px] leading-6">
                              <b className="text-slate-600">{c.label}:</b>{" "}
                              <span className="text-rose-500 line-through">{c.old}</span>{" "}
                              <span className="text-slate-400">←</span>{" "}
                              <span className="font-bold text-emerald-700">{c.new}</span>
                            </div>
                          )
                        ))}
                      </td>
                    ) : (
                      <>
                        <td className="p-2 text-slate-600" dir="ltr">{r.phone ?? r.oursPhone ?? "—"}</td>
                        <td className="max-w-[160px] truncate p-2 text-slate-600">{r.packageName ?? r.oursPackage ?? "—"}</td>
                      </>
                    )}
                    {(tab === "self" || tab === "sas") && (
                      <td className="whitespace-nowrap p-2 font-bold text-amber-700">
                        {num(r.amount)}
                        {/* زرّ «+» بجانب المبلغ (تبويب ٤): إضافة تفعيل (بوصلٍ لتقرير اليوم) أو إضافة دين */}
                        {tab === "sas" && canEdit && (
                          <span className="relative mr-1.5 inline-block">
                            <button onClick={() => setPlusFor(plusFor === r.id ? null : r.id)} disabled={busy}
                              className="h-6 w-6 rounded-full bg-mynet-blue text-sm font-extrabold text-white hover:opacity-90">+</button>
                            {plusFor === r.id && (
                              <span className="absolute left-0 top-7 z-10 flex w-40 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                                <button onClick={() => void act([r.id], "activate")} className="px-3 py-2 text-right text-[13px] font-bold text-emerald-700 hover:bg-emerald-50">🧾 إضافة تفعيل{r.oursPrice ? ` (${num(Math.round(r.oursPrice))})` : ""}</button>
                                <button onClick={() => void act([r.id], "debt")} className="border-t border-slate-100 px-3 py-2 text-right text-[13px] font-bold text-rose-700 hover:bg-rose-50">💳 إضافة دين{r.oursPrice ? ` (${num(Math.round(r.oursPrice))})` : ""}</button>
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap p-2 text-slate-500" dir="ltr">{formatDate(r.activatedAt ?? r.createdAt)}</td>
                    <td className="max-w-[120px] truncate p-2 text-slate-500">{r.towerName}</td>
                    {canEdit && tab !== "info" && (
                      <td className="whitespace-nowrap p-2">
                        {/* تنصيبٌ جديد: «حفظ» يستورده بلا وصل · قائمٌ (إعادة/ذاتيّ/ساس): «تحديث» */}
                        <button onClick={() => void act([r.id], "apply")} disabled={busy}
                          className="ml-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                          {tab === "install" && r.subscriberId == null ? "💾 حفظ" : isReplaceRow(r) ? "↔️ استبدال" : "✔ تحديث"}
                        </button>
                        <button onClick={() => void act([r.id], "ignore")} disabled={busy}
                          className="rounded-lg bg-slate-200 px-2.5 py-1 text-[12px] font-bold text-slate-600 hover:bg-slate-300 disabled:opacity-50">تجاهل</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
