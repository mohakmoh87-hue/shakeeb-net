"use client";

import { useCallback, useEffect, useState } from "react";
import MoneyTxModal from "@/components/MoneyTxModal";

type Item = { date: string; type: string; label: string; amount: number; reason?: string; txId?: number };
type Day = { date: string; amount: number; note: string };
type Statement = {
  daysPaid: number; cleanDays: number; dailyAmount: number; baseEarned: number; overtime: number; bonuses: number; credits: number;
  attendanceDeductions: number; confirmedDeductions: number; advances: number; net: number; periodFrom: string; periodTo: string; items: Item[]; dayDetails: Day[];
  // أ-١٦ · التقريب إلى الألف: `net` يبقى مجموعَ الخانات، و`paid` هو ما يُدفع فعلاً.
  // اختياريّةٌ كي لا تنكسر الواجهة إن استُدعيت من نسخةٍ أقدم من الـAPI.
  paid?: number; roundingAdd?: number; roundedDue?: number; due?: number; carryIn?: number; carryOut?: number;
};
type Period = { from: string | null; to: string | null };
type Archive = { id: number; periodFrom: string; periodTo: string; net: number; daysPaid: number; createdAt: string; paidByUser: string | null; paidAmount?: number | null; roundingAdd?: number | null };
// تفاصيل كشف سابق: كانت محفوظة كاملةً في القاعدة ولا تصل الواجهة إطلاقاً
// — فتقرأ «صافي كذا» بلا سبيل لمعرفة كيف تكوّن، ولا يمكن إلغاؤه (المرحلة ١٠).
type StView = {
  statement: {
    id: number; technicianName: string; periodFrom: string; periodTo: string; daysPaid: number; dailyAmount: number;
    baseEarned: number; overtime: number; bonuses: number; attendanceDeductions: number; confirmedDeductions: number;
    net: number; paidByUser: string | null;
    credits?: number; advances?: number; cleanDays?: number | null;
  };
  details: Item[];        // البنود كاملةً (label هو الوصف — كان يُقرأ بمفتاحٍ خاطئ فيظهر فارغاً)
  dayDetails?: Day[];     // تفصيل الأيام (للكشوف المحفوظة بعد 2026-08-09)
  cardCounts?: { kind: string; count: number }[];
  accountTxs?: { id: number; date: string; moneyIn: number; moneyOut: number; notes: string | null }[];
  payment: { id: number; amount: number; deleted: boolean } | null;
  cancelled: { at: string } | null;
};

const num = (n: number) => Number(n).toLocaleString("en-US");
const signed = (n: number) => (n >= 0 ? `+${num(n)}` : `−${num(Math.abs(n))}`);

// كشف راتب الفني — يعرضه المدير (مع «تسديد») والفني (قراءة فقط).
export default function SalaryModal({ technicianId, name, onClose, onSettled }: { technicianId?: number | null; name?: string; onClose: () => void; onSettled?: () => void }) {
  const isManager = technicianId != null;
  const [st, setSt] = useState<Statement | null>(null);
  const [history, setHistory] = useState<Archive[]>([]);
  const [openSt, setOpenSt] = useState<StView | null>(null);
  // حركة مالية مفتوحة التفاصيل من داخل بنود الراتب (سحب/إضافة للحساب)
  const [txDetail, setTxDetail] = useState<number | null>(null);
  const [stBusy, setStBusy] = useState(false);
  const [period, setPeriod] = useState<Period | null>(null);
  const [cardCounts, setCardCounts] = useState<{ kind: string; count: number }[]>([]); // بطاقات منجزة حسب الفئة ضمن الفترة
  const [techName, setTechName] = useState(name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [expand, setExpand] = useState<string | null>(null); // الخانة المفتوحة لعرض تفاصيلها
  const [archExpand, setArchExpand] = useState<string | null>(null); // خانة كشفٍ سابقٍ مفتوحة التفاصيل

  const load = useCallback(() => {
    const q = isManager ? `?technicianId=${technicianId}` : "";
    fetch(`/api/field/salary${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setSt(d.statement ?? null); setHistory(d.history ?? []); setPeriod(d.period ?? null); setCardCounts(d.cardCounts ?? []); if (d.name) setTechName(d.name);
    });
  }, [isManager, technicianId]);
  useEffect(() => { load(); }, [load]);

  async function settle(source: "daily" | "total") {
    const where = source === "daily" ? "كمصروفٍ في التقرير اليومي لليوم" : "خصماً من المبلغ الكلي (دون ظهوره في التقرير اليومي)";
    if (!confirm(`تسديد راتب «${techName}» ${where}؟\nيُصفَّر سجل الحضور والخصومات والإجازات ضمن الفترة فقط، وأي حركة بعد نهاية الفترة تُرحَّل للفترة القادمة.`)) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/field/salary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId, source }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر التسديد"); return; }
    setChoosing(false);
    setMsg(`تم التسديد ✓ (صُرف ${num(d.paid)} د.ع ${source === "daily" ? "من التقرير اليومي" : "من المبلغ الكلي"})`); load(); onSettled?.();
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">💰 راتب {techName}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>
        {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.includes("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}

        {!st ? (
          <div className="p-6 text-center text-sm text-slate-400">جاري الحساب…</div>
        ) : (
          <>
            {/* الصافي — يُعرَض **المُقرَّب** لأنه ما يُدفع فعلاً (أ-١٦) */}
            <div className="mb-3 rounded-2xl bg-gradient-to-l from-mynet-blue to-mynet-blue-dark p-4 text-center text-white">
              <div className="text-xs opacity-80">صافي الراتب المستحقّ</div>
              <div className="text-3xl font-extrabold">{num(st.roundedDue ?? st.net)} <span className="text-base font-normal">د.ع</span></div>
              <div className="mt-1 text-[11px] opacity-80" dir="ltr">{st.periodFrom} → {st.periodTo}</div>
              {!period?.from && <div className="mt-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">لم تُضبط فترة — يُحتسب كل السجل</div>}
            </div>

            {/* أ-١٦ · سطرُ التقريب أعلى التفاصيل — طلبُ محمد حرفيّاً: «يُكتب أعلى سطر عند رؤية
                التفاصيل: تم إضافة المبلغ هذا لتقريب الراتب». والعملة العراقية بلا دينارٍ ولا
                مئة دينار، والتقريبُ على **المجموع النهائي وحده** لا على كل يوم، والمستفيدُ
                دائماً الفنيّ: الموجب يُرفع والسالبُ يُنقَص دَينُه. */}
            {(st.roundingAdd ?? 0) > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-[12px] font-bold text-amber-800">
                تم إضافة <span className="text-sm">{num(st.roundingAdd ?? 0)}</span> د.ع لتقريب الراتب
                <div className="mt-0.5 text-[10px] font-normal text-amber-700">
                  الصافي المحسوب {num(st.due ?? st.net)} ← المدفوع {num(st.roundedDue ?? st.net)} (أقرب ألف لمصلحة الفنيّ)
                </div>
              </div>
            )}

            {/* التفصيل — كل خانة قابلة للنقر لعرض تفاصيلها */}
            <p className="mb-1.5 text-center text-[11px] text-slate-400">اضغط أي خانة لعرض تفاصيلها 👇</p>
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <Cell k="days" label={`مبالغ الأيام (${st.daysPaid})`} value={num(st.baseEarned)} tone="pos" expand={expand} setExpand={setExpand} />
              <Cell k="overtime" label="الإضافي" value={num(st.overtime)} tone="pos" expand={expand} setExpand={setExpand} />
              <Cell k="bonus" label="المكافآت" value={num(st.bonuses)} tone="pos" expand={expand} setExpand={setExpand} />
              <Cell k="credit" label="إضافة للحساب (قبض)" value={num(st.credits ?? 0)} tone="pos" expand={expand} setExpand={setExpand} />
              <Cell k="attded" label="خصم الحضور" value={num(st.attendanceDeductions)} tone="neg" expand={expand} setExpand={setExpand} />
              <Cell k="confded" label="خصومات مؤكّدة" value={num(st.confirmedDeductions)} tone="neg" expand={expand} setExpand={setExpand} />
              <Cell k="advance" label="سحب من الحساب (صرف)" value={num(st.advances ?? 0)} tone="neg" expand={expand} setExpand={setExpand} />
              <Cell k="clean" label="بصمات سليمة" value={String(st.cleanDays)} tone="mut" expand={expand} setExpand={setExpand} />
            </div>

            {/* لوحة التفاصيل للخانة المختارة */}
            {expand && <DetailPanel cat={expand} st={st} onClose={() => setExpand(null)} />}

            {/* البطاقات المنجزة خلال فترة الراتب — عدد فقط لكل فئة (من السجل الدائم) */}
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1.5 text-sm font-bold text-slate-700">
                🗂️ بطاقات منجزة خلال الفترة
                <span className="mr-1 text-xs font-normal text-slate-400">({num(cardCounts.reduce((s, c) => s + c.count, 0))} بطاقة)</span>
              </div>
              {cardCounts.length === 0 ? (
                <div className="text-xs text-slate-400">لا بطاقات منجزة ضمن هذه الفترة</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {cardCounts.map((c) => (
                    <span key={c.kind} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                      {c.kind} <b className="text-mynet-blue">×{num(c.count)}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* كل البنود المؤثّرة */}
            <div className="mb-1 text-sm font-bold text-slate-700">كل البنود المؤثّرة</div>
            {st.items.length === 0 ? (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">لا بنود مؤثّرة (كل البصمات سليمة)</div>
            ) : (
              <ul className="mb-3 space-y-1">
                {st.items.map((it, i) => (
                  <li key={i}
                    onClick={() => it.txId && setTxDetail(it.txId)}
                    title={it.txId ? "اضغط لعرض الحركة المالية وراء هذا البند" : undefined}
                    className={
                      "flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs" +
                      (it.txId ? " cursor-pointer hover:border-mynet-blue hover:bg-white" : "")
                    }>
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-700">{it.label}{it.txId ? " ↗" : ""}</span>
                      <span className="mr-1 text-slate-400" dir="ltr"> {it.date}</span>
                      {it.reason && <div className="truncate text-[11px] text-slate-500">{it.reason}</div>}
                    </div>
                    <span className={`shrink-0 font-bold ${it.amount > 0 ? "text-emerald-600" : it.amount < 0 ? "text-rose-600" : "text-slate-400"}`}>{it.amount === 0 ? "—" : signed(it.amount)}</span>
                  </li>
                ))}
              </ul>
            )}

            {isManager && (
              !choosing ? (
                <button onClick={() => setChoosing(true)} disabled={busy} className="mb-4 w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {busy ? "..." : `💵 تسديد الراتب (${num(st.paid ?? Math.max(0, st.net))} د.ع)`}
                </button>
              ) : (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="mb-2 text-center text-sm font-bold text-slate-700">اختر طريقة التسديد ({num(st.paid ?? Math.max(0, st.net))} د.ع)</div>
                  <div className="grid gap-2">
                    <button onClick={() => settle("daily")} disabled={busy} className="rounded-xl bg-mynet-blue px-3 py-2.5 text-right font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
                      🧾 من التقرير اليومي
                      <span className="block text-[11px] font-normal opacity-90">يُسجَّل مصروفاً في تقرير اليوم — يُنقص المبلغ الكلي مرّة واحدة</span>
                    </button>
                    <button onClick={() => settle("total")} disabled={busy} className="rounded-xl bg-emerald-600 px-3 py-2.5 text-right font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                      🏦 من المبلغ الكلي
                      <span className="block text-[11px] font-normal opacity-90">يُخصم من المبلغ الكلي فقط — دون أي تغيير على التقرير اليومي</span>
                    </button>
                    <button onClick={() => setChoosing(false)} disabled={busy} className="rounded-xl bg-slate-100 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60">إلغاء</button>
                  </div>
                </div>
              )
            )}

            {/* الأرشيف */}
            {history.length > 0 && (
              <>
                <div className="mb-1 text-sm font-bold text-slate-700">كشوف سابقة</div>
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li key={h.id} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
                      <div className="flex cursor-pointer items-center justify-between gap-2"
                        onClick={() => {
                          if (openSt?.statement.id === h.id) { setOpenSt(null); setArchExpand(null); return; }
                          setStBusy(true); setArchExpand(null);
                          fetch(`/api/field/salary/statement/${h.id}`)
                            .then((r) => (r.ok ? r.json() : null))
                            .then((d) => setOpenSt(d))
                            .finally(() => setStBusy(false));
                        }}>
                        <span className="text-slate-500" dir="ltr">{h.periodFrom} → {h.periodTo}</span>
                        {/* الرمز (＋) لفتح تفاصيل الشهر السابق كاملةً — طلب محمد 2026-08-09 */}
                        {/* أ-١٦ · يُعرَض **المدفوع فعلاً** لا الصافي الخام؛ والكشوف الأقدم من
                            التقريب بلا `paidAmount` فتسقط إلى `net` كما كانت. */}
                        <span className="font-bold text-slate-700">{num(h.paidAmount ?? h.net)} د.ع · {h.daysPaid} يوم
                          {(h.roundingAdd ?? 0) > 0 && <span className="ms-1 text-[10px] font-normal text-amber-700">(+{num(h.roundingAdd ?? 0)} تقريب)</span>}
                          <span className="text-mynet-blue"> {openSt?.statement.id === h.id ? "－" : "＋"}</span></span>
                      </div>
                      {openSt?.statement.id === h.id && (
                        <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                          {openSt.cancelled && (
                            <div className="mb-1 rounded bg-red-50 px-2 py-1 font-bold text-red-700">هذا الكشف مُلغى</div>
                          )}
                          {openSt.payment?.deleted && !openSt.cancelled && (
                            <div className="mb-1 rounded bg-amber-50 px-2 py-1 font-bold text-amber-800">⚠️ قيد الصرف محذوف — الكشف يزعم دفعاً لم يعد قائماً</div>
                          )}
                          {/* ===== تفاصيل الشهر السابق — نفس الصناديق الثمانية للفترة الحاليّة (عرضٌ فقط) ===== */}
                          <p className="mb-1 text-center text-[11px] text-slate-400">اضغط أي خانة لعرض تفاصيلها 👇</p>
                          <div className="mb-2 grid grid-cols-2 gap-1.5 text-xs">
                            <Cell k="days" label={`مبالغ الأيام (${openSt.statement.daysPaid})`} value={num(openSt.statement.baseEarned)} tone="pos" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="overtime" label="الإضافي" value={num(openSt.statement.overtime)} tone="pos" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="bonus" label="المكافآت" value={num(openSt.statement.bonuses)} tone="pos" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="credit" label="إضافة للحساب (قبض)" value={num(openSt.statement.credits ?? 0)} tone="pos" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="attded" label="خصم الحضور" value={num(openSt.statement.attendanceDeductions)} tone="neg" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="confded" label="خصومات مؤكّدة" value={num(openSt.statement.confirmedDeductions)} tone="neg" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="advance" label="سحب من الحساب (صرف)" value={num(openSt.statement.advances ?? 0)} tone="neg" expand={archExpand} setExpand={setArchExpand} />
                            <Cell k="clean" label="بصمات سليمة" value={openSt.statement.cleanDays != null ? String(openSt.statement.cleanDays) : "—"} tone="mut" expand={archExpand} setExpand={setArchExpand} />
                          </div>
                          {archExpand && (
                            <DetailPanel
                              cat={archExpand}
                              st={{
                                daysPaid: openSt.statement.daysPaid, cleanDays: openSt.statement.cleanDays ?? 0,
                                dailyAmount: openSt.statement.dailyAmount, baseEarned: openSt.statement.baseEarned,
                                overtime: openSt.statement.overtime, bonuses: openSt.statement.bonuses,
                                credits: openSt.statement.credits ?? 0, attendanceDeductions: openSt.statement.attendanceDeductions,
                                confirmedDeductions: openSt.statement.confirmedDeductions, advances: openSt.statement.advances ?? 0,
                                net: openSt.statement.net, periodFrom: openSt.statement.periodFrom, periodTo: openSt.statement.periodTo,
                                items: openSt.details, dayDetails: openSt.dayDetails ?? [],
                              }}
                              onClose={() => setArchExpand(null)}
                            />
                          )}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-slate-100 pt-1.5">
                            <span className="font-bold">الصافي المدفوع</span><b className="text-emerald-700">{num(openSt.statement.net)}</b>
                            {openSt.statement.paidByUser && <><span>سدّده</span><b>{openSt.statement.paidByUser}</b></>}
                          </div>

                          {/* بطاقات تلك الفترة — من السجلّ الدائم (باقٍ بعد التسديد) */}
                          {(openSt.cardCounts?.length ?? 0) > 0 && (
                            <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                              <div className="mb-0.5 font-bold text-slate-700">🗂️ بطاقات منجزة ({num((openSt.cardCounts ?? []).reduce((s, c) => s + c.count, 0))})</div>
                              <div className="flex flex-wrap gap-1">
                                {(openSt.cardCounts ?? []).map((c) => (
                                  <span key={c.kind} className="rounded bg-slate-100 px-1.5 py-0.5">{c.kind}: <b>{c.count}</b></span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* حركات حساب الموظّف لتلك الفترة (باقيةٌ موسومةً بالكشف) — قابلة للفتح */}
                          {(openSt.accountTxs?.length ?? 0) > 0 && (
                            <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                              <div className="mb-0.5 font-bold text-slate-700">💵 سلف ومقبوضات الحساب</div>
                              <ul className="max-h-32 space-y-0.5 overflow-auto">
                                {/* الفتح للمدير فقط: مسار تفاصيل الحركة ماليٌّ (finance.view) ويرفض جلسة الفنيّ */}
                                {(openSt.accountTxs ?? []).map((m) => (
                                  <li key={m.id} className={`flex justify-between gap-2 rounded px-1 ${isManager ? "cursor-pointer hover:bg-slate-50" : ""}`} onClick={isManager ? () => setTxDetail(m.id) : undefined}>
                                    <span dir="ltr" className="text-slate-400">{String(m.date).slice(0, 10)}</span>
                                    <span className="flex-1 truncate">{m.notes ?? "—"}</span>
                                    <b className={m.moneyOut ? "text-rose-600" : "text-emerald-600"}>{m.moneyOut ? `−${num(m.moneyOut)}` : `+${num(m.moneyIn)}`}</b>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(openSt.dayDetails?.length ?? 0) === 0 && (
                            <div className="mt-1.5 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
                              ملاحظة: أوقات التبصيم الخام لهذه الفترة حُذفت لحظة التسديد — المعروض هو البنود المؤثّرة كاملةً. الكشوف من اليوم فصاعداً تحفظ تفصيل الأيام أيضاً.
                            </div>
                          )}
                          {isManager && !openSt.cancelled && (
                            <button
                              disabled={stBusy}
                              onClick={async () => {
                                if (!confirm(`إلغاء كشف ${openSt.statement.periodFrom} → ${openSt.statement.periodTo}؟\nيُعاد المبلغ ${num(openSt.statement.net)} بحذف قيد الصرف.\n\nتنبيه: سجلات الحضور والخصومات لتلك الفترة حُذفت لحظة التسديد فلا تعود.`)) return;
                                setStBusy(true);
                                const r = await fetch(`/api/field/salary/statement/${openSt.statement.id}`, { method: "POST" });
                                const d = await r.json().catch(() => ({}));
                                setStBusy(false);
                                if (r.ok) { alert(d.note ?? "أُلغي الكشف"); setOpenSt(null); load(); }
                                else alert(d.error ?? "تعذّر الإلغاء");
                              }}
                              className="mt-2 rounded bg-red-50 px-3 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
                            >إلغاء هذا الكشف</button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {/* الحركة المالية وراء بند «سحب/إضافة للحساب» — كان البند رقماً بلا مصدر */}
      {txDetail != null && <MoneyTxModal id={txDetail} onClose={() => setTxDetail(null)} onDeleted={load} />}
    </div>
  );
}

function Cell({ k, label, value, tone, expand, setExpand }: { k: string; label: string; value: string; tone: "pos" | "neg" | "mut"; expand: string | null; setExpand: (v: string | null) => void }) {
  const c = tone === "pos" ? "text-emerald-700 bg-emerald-50" : tone === "neg" ? "text-rose-700 bg-rose-50" : "text-slate-500 bg-slate-50";
  const active = expand === k;
  return (
    <button type="button" onClick={() => setExpand(active ? null : k)}
      className={`rounded-lg px-3 py-2 text-right transition ${c} ${active ? "ring-2 ring-mynet-blue" : "hover:brightness-95"}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="font-bold">{value} <span className="text-[10px] opacity-60">{active ? "▲" : "▾"}</span></div>
    </button>
  );
}

// لوحة تفاصيل الخانة المختارة — تعرض بنودها المفصّلة
function DetailPanel({ cat, st, onClose }: { cat: string; st: Statement; onClose: () => void }) {
  const titles: Record<string, string> = {
    days: "تفصيل مبالغ الأيام", overtime: "تفصيل الإضافي", bonus: "تفصيل المكافآت", credit: "تفصيل الإضافات للحساب (قبض)",
    attded: "تفصيل خصم الحضور", confded: "تفصيل الخصومات المؤكّدة", advance: "تفصيل السحب من الحساب (صرف)", clean: "الأيام السليمة",
  };
  let rows: { date: string; label: string; amount: number; reason?: string }[] = [];
  if (cat === "days") rows = st.dayDetails.map((d) => ({ date: d.date, label: d.note, amount: d.amount }));
  else if (cat === "clean") rows = st.dayDetails.filter((d) => d.note === "بصمة سليمة").map((d) => ({ date: d.date, label: "بصمة سليمة", amount: d.amount }));
  else {
    const types: Record<string, string[]> = {
      overtime: ["overtime"], bonus: ["bonus"], credit: ["credit"],
      attded: ["late", "early"], confded: ["deduction"], advance: ["advance"],
    };
    const wanted = types[cat] ?? [];
    rows = st.items.filter((it) => wanted.includes(it.type)).map((it) => ({ date: it.date, label: it.label, amount: it.amount, reason: it.reason }));
  }
  return (
    <div className="mb-3 rounded-xl border border-mynet-blue/30 bg-mynet-blue/5 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-700">{titles[cat] ?? "تفاصيل"}</span>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">إغلاق ✕</button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-center text-xs text-slate-400">لا بنود في هذه الخانة</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-xs shadow-sm">
              <div className="min-w-0">
                <span className="font-semibold text-slate-700">{r.label}</span>
                <span className="mr-1 text-slate-400" dir="ltr"> {r.date}</span>
                {r.reason && <div className="truncate text-[11px] text-slate-500">{r.reason}</div>}
              </div>
              <span className={`shrink-0 font-bold ${r.amount > 0 ? "text-emerald-600" : r.amount < 0 ? "text-rose-600" : "text-slate-500"}`}>{r.amount === 0 ? "—" : signed(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
