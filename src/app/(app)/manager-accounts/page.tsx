"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import OfficeChat from "@/components/OfficeChat";
import InstallComputer from "@/components/InstallComputer";
import RewardConfig from "@/components/RewardConfig";
import SalaryModal from "@/components/SalaryModal";

type WaOffice = { id: number; name: string | null; state: string };

type MgrTx = { id: number; type: string; amount: number; notes: string | null; date: string };

// سجل المبالغ اليومية: كل يوم بإجماليه وتفصيله حسب المكتب (البرج)
type DayAgg = { moneyIn: number; moneyOut: number; net: number; count: number };
type DayRow = DayAgg & { day: string; byOffice: Record<string, DayAgg> };
type DailyLog = {
  offices: { id: number; name: string }[];
  days: DayRow[];
  total: number;
  totalByOffice: Record<string, number>;
};
type Data = {
  cumulativeDaily: number;
  totalAvailable: number;
  cardDebtAdded: number;
  cardPayments: number;
  cardDebtRemaining: number;
  managerExpenses: number;
  managerReceipts: number;
  masterBalance: number;
  employees: { id: number; name: string | null; withdrawn: number; technicianId: number | null; net: number | null }[];
  transactions: MgrTx[];
  salaryPeriod: { fromDay: number | null; toDay: number | null; from: string | null; to: string | null } | null;
};
type MasterDetail = { balance: number; days: { day: string; in: number; out: number; net: number; count: number }[]; transactions: { id: number; moneyIn: number | null; moneyOut: number | null; notes: string | null; date: string }[] };

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");
const fmtDate = (d: string) => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const TYPE_LABEL: Record<string, string> = { expense: "مصروف", receipt: "مقبوض", "card-payment": "تسديد كارتات", salary: "راتب فني (من الكلي)" };

export default function ManagerAccountsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [denied, setDenied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waOffices, setWaOffices] = useState<WaOffice[]>([]);
  const [chatOffice, setChatOffice] = useState<WaOffice | null>(null);
  const [salaryTech, setSalaryTech] = useState<{ id: number; name: string } | null>(null);
  const [cardData, setCardData] = useState<{ packages: { id: number; name: string | null; priceDinar: number | null; cardCost: number | null }[]; canEdit: boolean } | null>(null);
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});
  const [priceMsg, setPriceMsg] = useState("");
  const [dailyLog, setDailyLog] = useState<DailyLog | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [logOffice, setLogOffice] = useState<number | "all">("all"); // المكتب المختار في السجل، all = الإجمالي
  const [masterDetail, setMasterDetail] = useState<MasterDetail | null>(null);
  const [showMaster, setShowMaster] = useState(false);
  // فترة احتساب الرواتب (عامة لكل الموظفين) — يومان من الشهر (بداية/نهاية) تتكرّران شهرياً
  const [pFromDay, setPFromDay] = useState("");
  const [pToDay, setPToDay] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodMsg, setPeriodMsg] = useState("");

  function openMaster() {
    setShowMaster(true); setMasterDetail(null);
    fetch("/api/manager-accounts/master").then((r) => void (r.ok && r.json().then(setMasterDetail)));
  }

  function openDailyLog() {
    setShowLog(true);
    setLogOffice("all");
    fetch("/api/manager-accounts/daily-log").then((r) => void (r.ok && r.json().then(setDailyLog)));
  }

  const load = useCallback(() => {
    fetch("/api/manager-accounts").then((r) => {
      if (r.status === 403) { setDenied(true); setLoaded(true); return; }
      if (r.ok) r.json().then((d) => { setData(d); setLoaded(true); });
      else setLoaded(true);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  // مزامنة حقلي اليوم مع القيم المحفوظة (عند التحميل/بعد الحفظ)
  useEffect(() => {
    if (data?.salaryPeriod) {
      setPFromDay(data.salaryPeriod.fromDay != null ? String(data.salaryPeriod.fromDay) : "");
      setPToDay(data.salaryPeriod.toDay != null ? String(data.salaryPeriod.toDay) : "");
    }
  }, [data?.salaryPeriod?.fromDay, data?.salaryPeriod?.toDay]);

  async function savePeriod() {
    setPeriodMsg("");
    const f = Number(pFromDay), t = Number(pToDay);
    if (!f || !t || f < 1 || f > 31 || t < 1 || t > 31) { setPeriodMsg("أدخل يومَي البداية والنهاية (1 إلى 31)"); return; }
    setSavingPeriod(true);
    const r = await fetch("/api/field/salary-period", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromDay: f, toDay: t }) });
    setSavingPeriod(false);
    if (r.ok) { setPeriodMsg("✓ حُفظت الفترة — تتكرّر كل شهر وتُطبَّق على رواتب كل الموظفين"); load(); }
    else { const d = await r.json().catch(() => ({})); setPeriodMsg(d.error ?? "تعذّر الحفظ"); }
  }

  // محادثات واتساب المكاتب (صلاحية whatsapp.chat)
  useEffect(() => {
    fetch("/api/whatsapp/offices").then((r) => void (r.ok && r.json().then((d) => setWaOffices(d.offices ?? []))));
  }, []);

  // أسعار الكارت لكل فئة (يظهر محرّرها لصاحب صلاحية cardprice.manage)
  const loadPrice = useCallback(() => {
    fetch("/api/card-price").then((r) => void (r.ok && r.json().then((d) => {
      setCardData(d);
      const inp: Record<number, string> = {};
      for (const pk of (d.packages ?? [])) inp[pk.id] = String(pk.cardCost ?? 0);
      setPriceInputs(inp);
    })));
  }, []);
  useEffect(() => { loadPrice(); }, [loadPrice]);

  async function savePrice(packageId: number) {
    setPriceMsg("");
    const res = await fetch("/api/card-price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId, price: Number(priceInputs[packageId]) || 0 }) });
    if (res.ok) { setPriceMsg("✓ تم حفظ السعر (يُطبَّق على الكروت الجديدة فقط)"); loadPrice(); }
    else { const d = await res.json().catch(() => ({})); setPriceMsg(d.error ?? "فشل"); }
  }

  async function submit(type: "expense" | "receipt" | "card-payment" | "master-receipt" | "master-expense") {
    setError("");
    if (!amount || Number(amount) <= 0) { setError("أدخل مبلغاً صحيحاً"); return; }
    if ((type === "expense" || type === "receipt") && !notes.trim()) { setError("اكتب سبب/ملاحظة الحركة"); return; }
    setBusy(true);
    const res = await fetch("/api/manager-accounts/tx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount: Number(amount), notes: notes || null }),
    });
    setBusy(false);
    if (res.ok) { setAmount(""); setNotes(""); load(); if (showMaster) openMaster(); }
    else { const d = await res.json().catch(() => ({})); setError(d.error ?? "فشل"); }
  }

  async function del(id: number) {
    if (!window.confirm("حذف هذه الحركة؟")) return;
    const res = await fetch(`/api/manager-accounts/tx?id=${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (!loaded) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  // ممنوع تماماً فقط إذا لا حسابات ولا واتساب ولا صلاحية سعر الكارت
  if (denied && waOffices.length === 0 && !cardData?.canEdit) return <div className="p-6"><PageHeader title="حسابات المدير" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية الاطلاع على حسابات الإدارة.</div></div>;

  return (
    <div className="p-6">
      <PageHeader
        title="حسابات المدير"
        subtitle="حسابات الإدارة وواتساب المكاتب"
        action={<a href="/hybrid" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700">🖥️ حواسيب النظام الهجين</a>}
      />

      {/* تنصيب حاسبة مكتب — تعليمات كاملة + أمر آمن برمز لمرّة واحدة */}
      <InstallComputer />

      {/* واتساب المكاتب — فتح محادثات كل مكتب والرد عليها */}
      {waOffices.length > 0 && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <h3 className="mb-2 font-bold text-slate-800">💬 واتساب المكاتب</h3>
          <p className="mb-3 text-xs text-slate-500">اضغط على مكتب لفتح محادثات واتساب الخاصة به (عرض، قراءة، ورد على رسائل المشتركين).</p>
          <div className="flex flex-wrap gap-2">
            {waOffices.map((o) => (
              <button key={o.id} onClick={() => setChatOffice(o)} className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-emerald-100">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${o.state === "ready" ? "bg-emerald-500" : "bg-slate-300"}`} />
                {o.name ?? `مكتب ${o.id}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {chatOffice && <OfficeChat officeId={chatOffice.id} officeName={chatOffice.name ?? `مكتب ${chatOffice.id}`} state={chatOffice.state} onClose={() => setChatOffice(null)} />}

      {/* كشف راتب الموظف (الفني): تفاصيل + تسديد — نفس نافذة إدارة الفنيين */}
      {salaryTech && <SalaryModal technicianId={salaryTech.id} name={salaryTech.name} onClose={() => setSalaryTech(null)} onSettled={load} />}

      {/* تحديد سعر الكارت لكل فئة (صلاحية cardprice.manage) — يُطبَّق على الكروت الجديدة فقط */}
      {cardData?.canEdit && (
        <div className="mb-6 max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 font-bold text-slate-800">💳 سعر الكارت لكل فئة</h3>
          <p className="mb-3 text-xs text-slate-500">حدّد سعر شراء الكارت الواحد لكل فئة. يُطبَّق تلقائياً عند إضافة كروت الفئة، وتغييره يشمل الكروت الجديدة فقط.</p>
          {cardData.packages.length === 0 ? <div className="text-sm text-slate-400">لا توجد فئات بعد — أضِفها من صفحة الباقات.</div> : (
            <div className="space-y-2">
              {cardData.packages.map((pk) => (
                <div key={pk.id} className="flex items-center gap-2">
                  <div className="w-32 shrink-0 text-sm font-medium text-slate-700">{pk.name ?? `#${pk.id}`}</div>
                  <input type="number" value={priceInputs[pk.id] ?? ""} onChange={(e) => setPriceInputs((m) => ({ ...m, [pk.id]: e.target.value }))} placeholder="سعر الكارت" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <button onClick={() => savePrice(pk.id)} className="shrink-0 rounded-lg bg-mynet-blue px-3 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark">حفظ</button>
                </div>
              ))}
            </div>
          )}
          {priceMsg && <div className="mt-2 text-sm text-emerald-700">{priceMsg}</div>}
        </div>
      )}

      {/* مبلغ مكافأة التفعيل لكل باقة (للمدير) */}
      <RewardConfig />

      {/* لا صلاحية مالية → اكتفِ بقسم الواتساب */}
      {denied || !data ? null : (
      <>
      {/* البطاقات الرئيسية */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card label="المبلغ الكلي الموجود" value={fmt(data.totalAvailable)} color="text-emerald-700" bg="bg-emerald-50" big />
        <Card label="مجموع المبالغ اليومية" value={fmt(data.cumulativeDaily)} color="text-slate-700" bg="bg-slate-50" onClick={openDailyLog} hint="اضغط لعرض السجل اليومي" />
        <Card label="ديون الكارتات" value={fmt(data.cardDebtRemaining)} color="text-red-700" bg="bg-red-50" />
        <Card label="مصروفات الإدارة" value={fmt(data.managerExpenses)} color="text-amber-700" bg="bg-amber-50" />
        <Card label="🅜 حساب الماستر (مستقل)" value={fmt(data.masterBalance)} color="text-indigo-700" bg="bg-indigo-50" onClick={openMaster} hint="اضغط لعرض تفاصيله اليومية" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* نموذج حركة جديدة */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-bold text-slate-800">حركة جديدة (حساب المدير)</h3>
            <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ (د.ع)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2" />
            <label className="mb-1 block text-sm font-medium text-slate-700">السبب / ملاحظة</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: إيجار المكتب" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2" />
            {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => submit("expense")} disabled={busy} className="rounded-lg bg-red-600 py-2.5 font-semibold text-white hover:bg-red-700 disabled:opacity-60">− صرف</button>
              <button onClick={() => submit("receipt")} disabled={busy} className="rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">+ قبض</button>
            </div>
            <button onClick={() => submit("card-payment")} disabled={busy} className="mt-2 w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">💳 تسديد ديون كارتات (متبقّي {fmt(data.cardDebtRemaining)})</button>
            {/* حساب الماستر — مستقل تماماً عن بقية الحسابات */}
            <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-2">
              <div className="mb-1.5 text-center text-xs font-semibold text-indigo-700">🅜 حساب الماستر (مستقل) — الرصيد {fmt(data.masterBalance)}</div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => submit("master-expense")} disabled={busy} className="rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">− صرف ماستر</button>
                <button onClick={() => submit("master-receipt")} disabled={busy} className="rounded-lg bg-indigo-500 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-60">+ قبض ماستر</button>
              </div>
            </div>
          </div>

          {/* فترة احتساب الرواتب — يومان من الشهر (بداية/نهاية) تتكرّران كل شهر */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
            <h3 className="mb-1 font-bold text-slate-800">🗓️ فترة احتساب الرواتب</h3>
            <p className="mb-3 text-xs text-slate-600">حدّد <b>يوم البداية</b> و<b>يوم النهاية</b> فقط (بلا شهر/سنة). تمتدّ الفترة من يوم البداية في شهرٍ إلى يوم النهاية في <b>الشهر التالي</b> (نحو شهر)، و<b>تتكرّر تلقائياً لكل الأشهر</b> حتى تغيّرها. تُطبَّق على رواتب كل الموظفين.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-slate-500">من يوم</span>
                <input type="number" min={1} max={31} value={pFromDay} onChange={(e) => setPFromDay(e.target.value)} dir="ltr" placeholder="9" className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-center text-sm" /></label>
              <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-slate-500">إلى يوم (الشهر التالي)</span>
                <input type="number" min={1} max={31} value={pToDay} onChange={(e) => setPToDay(e.target.value)} dir="ltr" placeholder="10" className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-center text-sm" /></label>
            </div>
            {data.salaryPeriod?.from && data.salaryPeriod?.to && (
              <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] text-slate-600">الفترة الحالية: <b dir="ltr">{data.salaryPeriod.from} → {data.salaryPeriod.to}</b></div>
            )}
            {periodMsg && <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${periodMsg.includes("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{periodMsg}</div>}
            <div className="mt-2">
              <button onClick={savePeriod} disabled={savingPeriod} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{savingPeriod ? "..." : "حفظ الفترة"}</button>
            </div>
            {!data.salaryPeriod?.fromDay && <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">لم تُضبط فترة بعد — يُحتسب حالياً كامل سجل الموظف. حدّد يومَي الفترة لتقييد الاحتساب.</div>}
          </div>

          {/* الموظفون — الراتب المتبقي + تفاصيل + تسديد */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-bold text-slate-800">رواتب الموظفين</h3>
            <p className="mb-2 text-xs text-slate-500">الراتب المتبقّي لكل موظف (فني) بعد الحضور والخصومات ضمن الفترة المحدّدة. اضغط «تفاصيل» للكشف، و«تسديد» لصرف راتبه.</p>
            {data.employees.length === 0 ? <div className="text-sm text-slate-400">لا توجد حسابات موظفين</div> : (
              <table className="w-full text-right text-sm">
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="py-2 font-medium">{e.name ?? "—"}</td>
                      <td className="py-2 font-bold text-emerald-700">{e.net != null ? `${fmt(e.net)} د.ع` : <span className="text-xs font-normal text-slate-400">حساب غير مرتبط بفني</span>}</td>
                      <td className="py-2 text-left">
                        {e.technicianId != null && (
                          <button onClick={() => setSalaryTech({ id: e.technicianId!, name: e.name ?? "الموظف" })} className="rounded-lg bg-mynet-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-mynet-blue-dark">💰 تفاصيل / تسديد</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* سجل حركات المدير */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="p-3">#</th><th className="p-3">التاريخ</th><th className="p-3">النوع</th><th className="p-3">المبلغ</th><th className="p-3">ملاحظة</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {data.transactions.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد حركات</td></tr>
              ) : data.transactions.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-400">{t.id}</td>
                  <td className="p-3" dir="ltr">{fmtDate(t.date)}</td>
                  <td className="p-3">{TYPE_LABEL[t.type] ?? t.type}</td>
                  <td className={`p-3 font-bold ${t.type === "receipt" ? "text-emerald-600" : "text-red-600"}`}>{fmt(t.amount)}</td>
                  <td className="p-3 text-slate-600">{t.notes ?? "—"}</td>
                  <td className="p-3"><button onClick={() => del(t.id)} className="rounded bg-red-50 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-100">حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* سجل مجموع المبالغ اليومية (كل يوم بتاريخه وصافي مبلغه) */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLog(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800">سجل المبالغ اليومية</h3>
                <p className="text-xs text-slate-500">كل يوم يُضاف صافي مبلغ التقرير إلى المجموع{logOffice !== "all" ? " — معروض لمكتب واحد" : ""}</p>
              </div>
              <button onClick={() => setShowLog(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            {/* اختيار المكتب: الإجمالي أو كل مكتب على حِدة */}
            {dailyLog && dailyLog.offices.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
                <button
                  onClick={() => setLogOffice("all")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${logOffice === "all" ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  الإجمالي
                </button>
                {dailyLog.offices.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setLogOffice(o.id)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${logOffice === o.id ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            )}

            <div className="overflow-auto">
              {(() => {
                if (!dailyLog) return <div className="p-8 text-center text-slate-400">جاري التحميل...</div>;

                // اختيار البيانات حسب المكتب المحدد (أو الإجمالي)
                const rows = dailyLog.days
                  .map((d) => {
                    const agg: DayAgg = logOffice === "all" ? d : (d.byOffice[String(logOffice)] ?? { moneyIn: 0, moneyOut: 0, net: 0, count: 0 });
                    return { day: d.day, ...agg };
                  })
                  .filter((d) => logOffice === "all" || d.count > 0);
                const total = logOffice === "all" ? dailyLog.total : (dailyLog.totalByOffice[String(logOffice)] ?? 0);

                if (rows.length === 0) return <div className="p-8 text-center text-slate-400">لا توجد حركات بعد</div>;

                return (
                  <table className="w-full text-right text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600">
                      <tr><th className="p-3">التاريخ</th><th className="p-3">قبض</th><th className="p-3">صرف</th><th className="p-3">صافي اليوم</th><th className="p-3">حركات</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.day} className="border-t border-slate-100">
                          <td className="p-3 font-medium" dir="ltr">{d.day}</td>
                          <td className="p-3 text-emerald-600">{d.moneyIn ? fmt(d.moneyIn) : "—"}</td>
                          <td className="p-3 text-red-600">{d.moneyOut ? fmt(d.moneyOut) : "—"}</td>
                          <td className={`p-3 font-bold ${d.net >= 0 ? "text-slate-800" : "text-red-600"}`}>{fmt(d.net)}</td>
                          <td className="p-3 text-slate-400">{d.count}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-slate-100 font-bold">
                      <tr><td className="p-3">{logOffice === "all" ? "المجموع الكلي" : "مجموع المكتب"}</td><td colSpan={2}></td><td className="p-3 text-emerald-700">{fmt(total)}</td><td></td></tr>
                    </tfoot>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {/* تفاصيل حساب الماستر اليومية */}
      {showMaster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowMaster(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-indigo-50 px-4 py-3">
              <div>
                <h3 className="text-lg font-bold text-indigo-800">🅜 حساب الماستر</h3>
                <p className="text-xs text-slate-500">حساب مستقل تماماً — تفعيلات الماستر + قبض/صرف الماستر</p>
              </div>
              <button onClick={() => setShowMaster(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>
            <div className="border-b border-slate-200 bg-white px-4 py-2.5 text-center">
              <span className="text-sm text-slate-500">الرصيد الكلي: </span>
              <span className="text-xl font-extrabold text-indigo-700">{fmt(masterDetail?.balance ?? 0)} د.ع</span>
            </div>
            <div className="overflow-auto">
              {!masterDetail ? <div className="p-8 text-center text-slate-400">جاري التحميل...</div>
              : masterDetail.days.length === 0 ? <div className="p-8 text-center text-slate-400">لا توجد حركات ماستر بعد</div> : (
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr><th className="p-3">التاريخ</th><th className="p-3">قبض</th><th className="p-3">صرف</th><th className="p-3">صافي اليوم</th><th className="p-3">حركات</th></tr>
                  </thead>
                  <tbody>
                    {masterDetail.days.map((d) => (
                      <tr key={d.day} className="border-t border-slate-100">
                        <td className="p-3 font-medium" dir="ltr">{d.day}</td>
                        <td className="p-3 text-emerald-600">{d.in ? fmt(d.in) : "—"}</td>
                        <td className="p-3 text-red-600">{d.out ? fmt(d.out) : "—"}</td>
                        <td className={`p-3 font-bold ${d.net >= 0 ? "text-indigo-700" : "text-red-600"}`}>{fmt(d.net)}</td>
                        <td className="p-3 text-slate-400">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-indigo-50 font-bold">
                    <tr><td className="p-3">الرصيد الكلي</td><td colSpan={2}></td><td className="p-3 text-indigo-700">{fmt(masterDetail.balance)}</td><td></td></tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color, bg, big, onClick, hint }: { label: string; value: string; color: string; bg: string; big?: boolean; onClick?: () => void; hint?: string }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-slate-200 ${bg} p-5 shadow-sm ${onClick ? "cursor-pointer transition hover:border-mynet-blue hover:shadow-md" : ""}`}
    >
      <div className="text-sm text-slate-600">{label}</div>
      <div className={`${big ? "text-3xl" : "text-2xl"} font-extrabold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">{hint ? <span className="text-mynet-blue">{hint} ↗</span> : "د.ع"}</div>
    </div>
  );
}
