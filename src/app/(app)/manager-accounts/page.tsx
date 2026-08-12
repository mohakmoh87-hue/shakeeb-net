"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import OfficeChat from "@/components/OfficeChat";
import InstallComputer from "@/components/InstallComputer";
import RewardConfig from "@/components/RewardConfig";
import SalaryModal from "@/components/SalaryModal";
import { usePermission } from "@/lib/usePermission";

type WaOffice = { id: number; name: string | null; state: string };

type MgrTx = { id: number; type: string; amount: number; notes: string | null; date: string; byUser: string | null };

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
  salaryFromTotal: number; // رواتب سُدِّدت «من المبلغ الكلي» — كانت تُطرح بصمت
  managerReceipts: number;
  masterBalance: number;
  employees: { id: number; name: string | null; withdrawn: number; technicianId: number | null; net: number | null }[];
  transactions: MgrTx[];
  salaryPeriod: { fromDay: number | null; toDay: number | null; from: string | null; to: string | null } | null;
};
type MasterDetail = { balance: number; days: { day: string; in: number; out: number; net: number; count: number; offices?: { towerId: number; name: string; net: number }[] }[]; transactions: { id: number; moneyIn: number | null; moneyOut: number | null; notes: string | null; date: string; office: string | null; by: string | null }[] };
// كارت وهمي: عُلِّم مستخدماً في البرنامج بلا تفعيل مقابل في SAS (بعد تحقّق مباشر)
type PhantomCard = { cardId: number; serial: string | null; subscriber: string | null; office: string | null; useDate: string | null; amount: number | null; cardPrice: number; detectedAt: string | null };

// رصيد المدير: كل ما أودعه في النظام − كل ما سحبه منه (عبر مكاتبه وحسابات المدير والماستر)
type MgrBalance = {
  id: number; name: string; deposited: number; withdrawn: number; net: number;
  byOffice: { towerId: number; office: string; deposited: number; withdrawn: number; net: number }[];
  general: number; master: number; opening: number;
};

// كل حركات مدير واحد: قناة مكاتبه (ما يسجّله المستخدم من المصروفات والمقبوضات)
// + حساباته العامة والماستر والرصيد السابق — في قائمة واحدة (طلب محمد 2026-08-04)
type MgrTxRow = {
  key: string; id: number; source: "money" | "manager"; date: string;
  office: string | null; kind: string; deposited: number; withdrawn: number;
  notes: string | null; by: string | null; affectsReport: boolean;
};
type MgrDetail = {
  manager: { id: number; name: string };
  rows: MgrTxRow[];
  totals: { deposited: number; withdrawn: number; net: number; count: number };
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");
const fmtDate = (d: string) => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const TYPE_LABEL: Record<string, string> = { expense: "مصروف", receipt: "مقبوض", "card-payment": "تسديد كارتات", salary: "راتب فني (من الكلي)", "card-debt-add": "إضافة يدوية لديون الكارتات", "card-debt-sub": "إنقاص يدوي من ديون الكارتات", "master-expense": "🅜 صرف ماستر", "master-receipt": "🅜 قبض ماستر", "opening-receipt": "رصيد سابق (إكسل) — أعطى", "opening-expense": "رصيد سابق (إكسل) — سحب" };

export default function ManagerAccountsPage() {
  // حذف أي حركة يتطلّب صلاحية «مسح الوصولات» صراحةً (شرط محمد 2026-08-04):
  // لم تُمنح لأحد بعد، فالحذف للمدير وحده.
  const { can } = usePermission();
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
  // أ-٦ · اليومُ المضغوط ⇒ نافذةُ تقريره الكاملة (طلب محمد 2026-08-11).
  // والجلبُ في **مُعالِج الضغط** لا في `useEffect`: قاعدةُ `set-state-in-effect` محقّة، ولا
  // حاجةَ إلى أثرٍ لحدثٍ يبدأ بنقرةٍ صريحة.
  const [dayView, setDayView] = useState<{ day: string; towerId: number | null } | null>(null);
  const [dayRep, setDayRep] = useState<Record<string, number> | null>(null);
  async function openDay(day: string, towerId: number | null) {
    setDayView({ day, towerId });
    setDayRep(null);
    const q = new URLSearchParams({ day, towerId: towerId == null ? "all" : String(towerId) });
    const r = await fetch(`/api/reports/daily?${q}`).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    setDayRep(d && !d.error ? d : null);
  }
  const [showLog, setShowLog] = useState(false);
  const [logOffice, setLogOffice] = useState<number | "all">("all"); // المكتب المختار في السجل، all = الإجمالي
  const [masterDetail, setMasterDetail] = useState<MasterDetail | null>(null);
  const [showMaster, setShowMaster] = useState(false);
  const [showTotal, setShowTotal] = useState(false); // تفكيك «المبلغ الكلي الموجود»
  // فترة احتساب الرواتب (عامة لكل الموظفين) — يومان من الشهر (بداية/نهاية) تتكرّران شهرياً
  const [pFromDay, setPFromDay] = useState("");
  const [pToDay, setPToDay] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodMsg, setPeriodMsg] = useState("");
  // لوحة الكروت الوهمية
  const [phantomCards, setPhantomCards] = useState<PhantomCard[]>([]);
  const [phantomSel, setPhantomSel] = useState<Set<number>>(new Set());
  const [phantomLoaded, setPhantomLoaded] = useState(false);
  const [phantomDenied, setPhantomDenied] = useState(false);
  const [phantomBusy, setPhantomBusy] = useState(false);
  const [phantomMsg, setPhantomMsg] = useState("");
  // المدراء: أرصدتهم + المدير المُنسب إليه كل حركة مصروف/مقبوض/ماستر
  const [managers, setManagers] = useState<MgrBalance[]>([]);
  const [txManager, setTxManager] = useState<"" | number>(""); // "" = من المبلغ الكلي مباشرة
  const [newMgr, setNewMgr] = useState("");
  const [mgrBusy, setMgrBusy] = useState(false);
  const [mgrMsg, setMgrMsg] = useState("");
  const [openMgr, setOpenMgr] = useState<number | null>(null);
  const [mgrDetail, setMgrDetail] = useState<MgrDetail | null>(null); // نافذة «تفاصيل» المدير
  const [mgrDetailQ, setMgrDetailQ] = useState("");
  const [txQ, setTxQ] = useState(""); // بحث في سجل حركات المدير

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
  const loadManagers = useCallback(() => {
    fetch("/api/managers").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setManagers(d.managers ?? []); }).catch(() => {});
  }, []);
  useEffect(() => { load(); loadManagers(); }, [load, loadManagers]);

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

  // أسعار الكارت لكل فئة (محرّرها للمدير حصراً — قرار محمد: بلا صلاحية)
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

  // لوحة الكروت الوهمية: جلب المعلَّقة + إجراء (إرجاع/حذف) على المحدَّدة
  const loadPhantom = useCallback(() => {
    fetch("/api/manager/phantom-cards").then((r) => {
      if (r.status === 403) { setPhantomDenied(true); setPhantomLoaded(true); return; }
      if (r.ok) r.json().then((d) => { setPhantomCards(d.cards ?? []); setPhantomSel(new Set()); setPhantomLoaded(true); });
      else setPhantomLoaded(true);
    });
  }, []);
  useEffect(() => { loadPhantom(); }, [loadPhantom]);

  async function phantomAction(action: "return" | "delete" | "link") {
    setPhantomMsg("");
    const cardIds = [...phantomSel];
    if (cardIds.length === 0) { setPhantomMsg("علّم كارتاً واحداً على الأقل"); return; }
    // «ربط بمشتركه»: يسأل SAS مَن استعمل هذا السيريال فعلاً ويربطه به —
    // وإن لم يجده أخبرك أن الكارت غير مستخدم (طلب محمد 2026-08-05).
    if (action === "link") {
      setPhantomBusy(true);
      const r = await fetch("/api/manager/phantom-cards", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, cardIds }),
      });
      const d = await r.json().catch(() => ({}));
      setPhantomBusy(false);
      if (!r.ok) { setPhantomMsg(d.error ?? "تعذّرت العملية"); return; }
      type LinkRes = { serial: string | null; status: string; subscriber?: string; office?: string };
      const rows: LinkRes[] = d.results ?? [];
      const label = (x: LinkRes) => {
        const head = (x.serial ?? "?") + ": ";
        if (x.status === "linked") return "✅ " + head + "رُبط بـ" + (x.subscriber ?? "") + (x.office ? " (" + x.office + ")" : "");
        if (x.status === "not-used") return "⚪ " + head + "هذا الكارت غير مستخدم في SAS";
        if (x.status === "sas-user-not-in-app") return "⚠️ " + head + "مستعمله في SAS «" + (x.subscriber ?? "") + "» غير موجود في البرنامج";
        if (x.status === "sas-unreachable") return "⛔ " + head + "تعذّر الوصول إلى SAS — شغّل حاسبة المكتب وأعد المحاولة";
        return "⚠️ " + head + x.status;
      };
      setPhantomMsg(rows.map(label).join(" · "));
      loadPhantom();
      return;
    }
    const verb = action === "return" ? "إرجاع للمخزن" : "حذف نهائي";
    // ديون الكارتات **لا تنقص** بالحذف (طلب محمد 2026-08-10): الكارت مُشترى من الموزّع
    // فالدين قائمٌ عليه، وخلوّه من تفعيلٍ في SAS لا يُلغي ثمنه. الخادم يُسجّل حركةً معاوِضة.
    const selDebt = phantomCards.filter((c) => phantomSel.has(c.cardId)).reduce((sum, c) => sum + (c.cardPrice ?? 0), 0);
    const confirmText = action === "delete"
      ? `حذف نهائي لـ ${cardIds.length} كارت وهمي؟\n\n«ديون الكارتات» لا تنقص — يبقى ${fmt(selDebt)} د.ع مسجّلاً ديناً عليك (الكروت مُشتراة من الموزّع)، وتظهر حركةٌ معاوِضة في سجلّ الحسابات.\nلا يُمَسّ الوصل ولا مبالغ التقرير اليومي.\nالحذف نهائي ولا يمكن التراجع عنه.`
      : `إرجاع ${cardIds.length} كارت وهمي للمخزن؟\n\nيعود الكارت متاحاً للاستعمال — ولا يتغيّر شيء في ديون الكارتات (يبقى سعره مسجّلاً).`;
    if (!window.confirm(confirmText)) return;
    setPhantomBusy(true);
    const res = await fetch("/api/manager/phantom-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, cardIds }) });
    setPhantomBusy(false);
    if (res.ok) {
      const d = await res.json();
      setPhantomMsg(action === "delete"
        ? `✓ حُذف ${d.affected ?? 0} كارت — ديون الكارتات لم تنقص (بقي ${fmt(d.keptDebt ?? 0)} د.ع ديناً بحركةٍ معاوِضة)`
        : `✓ أُرجع ${d.affected ?? 0} كارت للمخزن (بلا تغيير في الديون)`);
      loadPhantom();
      if (action === "delete") load(); // تحديث بطاقة «ديون الكارتات» فوراً على نفس الشاشة
    } else {
      const d = await res.json().catch(() => ({}));
      setPhantomMsg(d.error ?? "تعذّر تنفيذ الإجراء (تحقّق من صلاحية حذف الكروت)");
    }
  }

  async function submit(type: "expense" | "receipt" | "card-payment" | "master-receipt" | "master-expense" | "card-debt-add" | "card-debt-sub") {
    setError("");
    if (!amount || Number(amount) <= 0) { setError("أدخل مبلغاً صحيحاً"); return; }
    if ((type === "expense" || type === "receipt" || type === "card-debt-add" || type === "card-debt-sub") && !notes.trim()) { setError("اكتب سبب/ملاحظة الحركة"); return; }
    setBusy(true);
    const res = await fetch("/api/manager-accounts/tx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount: Number(amount), notes: notes || null, managerId: txManager === "" ? null : txManager }),
    });
    setBusy(false);
    if (res.ok) { setAmount(""); setNotes(""); load(); loadManagers(); if (showMaster) openMaster(); }
    else { const d = await res.json().catch(() => ({})); setError(d.error ?? "فشل"); }
  }

  // حذف حركة ماستر مفردة — المعرّف الموجب حركة مكتب (money_tx) والسالب حركة حساب مدير
  async function delMasterTx(id: number, label: string) {
    if (!confirm("حذف حركة الماستر؟\n" + label + "\n\nستُحذف نهائياً ويُصحَّح رصيد الماستر بمقدارها. لا تتأثر التقارير اليومية.")) return;
    const res = id < 0
      ? await fetch("/api/manager-accounts/tx?id=" + (-id), { method: "DELETE" })
      : await fetch("/api/money/" + id + "/void", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: true }) });
    if (res.ok) { openMaster(); load(); }
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  // «تفاصيل» المدير: كل حركاته المالية من كل القنوات، ومنها ما سجّله المستخدم
  // من صفحة المصروفات والمقبوضات على حساب هذا المدير في أي مكتب.
  function openMgrDetail(id: number) {
    setMgrDetail(null); setMgrDetailQ("");
    fetch(`/api/managers/${id}/transactions`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setMgrDetail(d); }).catch(() => {});
  }

  async function delMgrRow(r: MgrTxRow) {
    if (!confirm(`حذف هذه الحركة؟\n${r.kind} — ${fmt(r.deposited || r.withdrawn)} د.ع\n${r.notes ?? ""}`)) return;
    const res = r.source === "money"
      ? await fetch(`/api/money/${r.id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: true }) })
      : await fetch(`/api/manager-accounts/tx?id=${r.id}`, { method: "DELETE" });
    if (res.ok) { openMgrDetail(r.source === "money" ? (mgrDetail?.manager.id ?? 0) : (mgrDetail?.manager.id ?? 0)); loadManagers(); load(); }
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  async function addManager() {
    const name = newMgr.trim();
    if (!name) { setMgrMsg("اكتب اسم المدير"); return; }
    setMgrBusy(true); setMgrMsg("");
    const r = await fetch("/api/managers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const d = await r.json().catch(() => ({}));
    setMgrBusy(false);
    if (r.ok) {
      setNewMgr("");
      setMgrMsg("✓ أُنشئ «" + name + "» ومعه " + (d.accountsCreated ?? 0) + " حساب مصروف/مقبوض في مكاتبك");
      loadManagers();
    } else setMgrMsg(d.error ?? "تعذّر الإنشاء");
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

      {/* تحديد سعر الكارت لكل فئة (للمدير حصراً) — يُطبَّق على الكروت الجديدة فقط */}
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

      {/* 🔴 لوحة الكروت الوهمية: مراجعة يدوية + إرجاع للمخزن أو حذف (بلا مساس بالوصل/المال) */}
      {phantomLoaded && !phantomDenied && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-bold text-slate-800">🔴 الكروت الوهمية {phantomCards.length > 0 && <span className="text-rose-700">({phantomCards.length})</span>}</h3>
            <button onClick={loadPhantom} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">↻ تحديث</button>
          </div>
          <p className="mb-3 text-xs text-slate-500">كروت عُلِّمت «مستخدمة» في البرنامج بلا تفعيل مقابل في SAS (بعد تحقّق مباشر بالبحث). راجعها، علّم ما تشاء، ثم اختر إجراءً. لا يُمَسّ الوصل ولا المال.</p>
          {phantomCards.length === 0 ? (
            <div className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-700">لا توجد كروت وهمية بحاجة لمراجعة ✓</div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-rose-200 bg-white">
                <table className="w-full text-right text-sm">
                  <thead className="bg-rose-100/60 text-xs text-slate-600">
                    <tr>
                      <th className="p-2"><input type="checkbox" aria-label="تحديد الكل" checked={phantomSel.size === phantomCards.length && phantomCards.length > 0} onChange={(e) => setPhantomSel(e.target.checked ? new Set(phantomCards.map((c) => c.cardId)) : new Set())} /></th>
                      <th className="p-2">السيريال</th>
                      <th className="p-2">المشترك</th>
                      <th className="p-2">المكتب</th>
                      <th className="p-2">تاريخ الاستخدام</th>
                      <th className="p-2">مبلغ الوصل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phantomCards.map((c) => (
                      <tr key={c.cardId} className="border-t border-rose-100">
                        <td className="p-2"><input type="checkbox" aria-label={`تحديد ${c.serial ?? c.cardId}`} checked={phantomSel.has(c.cardId)} onChange={(e) => setPhantomSel((s) => { const n = new Set(s); if (e.target.checked) n.add(c.cardId); else n.delete(c.cardId); return n; })} /></td>
                        <td className="p-2 font-mono text-xs">{c.serial ?? "؟"}</td>
                        <td className="p-2">{c.subscriber ?? "—"}</td>
                        <td className="p-2">{c.office ?? "—"}</td>
                        <td className="p-2 text-xs text-slate-500">{c.useDate ? fmtDate(c.useDate) : "—"}</td>
                        <td className="p-2">{c.amount != null ? fmt(c.amount) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">محدَّد: {phantomSel.size}</span>
                <button onClick={() => phantomAction("link")} disabled={phantomBusy || phantomSel.size === 0}
                  className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                  title="يبحث في SAS عن مستعمل هذا الكارت فعلاً ويربطه به">🔗 ربط بمشتركه</button>
                <button onClick={() => phantomAction("return")} disabled={phantomBusy || phantomSel.size === 0} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">↩ إرجاع للمخزن</button>
                <button onClick={() => phantomAction("delete")} disabled={phantomBusy || phantomSel.size === 0} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">🗑 حذف نهائي</button>
              </div>
            </>
          )}
          {phantomMsg && <div className="mt-2 text-sm text-slate-700">{phantomMsg}</div>}
        </div>
      )}

      {/* لا صلاحية مالية → اكتفِ بقسم الواتساب */}
      {denied || !data ? null : (
      <>
      {/* البطاقات الرئيسية */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card label="المبلغ الكلي الموجود" value={fmt(data.totalAvailable)} color="text-emerald-700" bg="bg-emerald-50" big onClick={() => setShowTotal(true)} hint="اضغط لتفكيك المعادلة" />
        <Card label="مجموع المبالغ اليومية" value={fmt(data.cumulativeDaily)} color="text-slate-700" bg="bg-slate-50" onClick={openDailyLog} hint="اضغط لعرض السجل اليومي" />
        <Card label="ديون الكارتات" value={fmt(data.cardDebtRemaining)} color={data.cardDebtRemaining <= 0 ? "text-emerald-700" : "text-red-700"} bg={data.cardDebtRemaining <= 0 ? "bg-emerald-50" : "bg-red-50"} onClick={() => setTxQ("كارتات")} hint="اضغط لتصفية السجل على حركاتها" />
        <Card label="مصروفات الإدارة" value={fmt(data.managerExpenses)} color="text-amber-700" bg="bg-amber-50" onClick={() => setTxQ("مصروف")} hint="اضغط لتصفية السجل عليها" />
        <Card label="🅜 حساب الماستر (مستقل)" value={fmt(data.masterBalance)} color="text-indigo-700" bg="bg-indigo-50" onClick={openMaster} hint="اضغط لعرض تفاصيله اليومية" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* نموذج حركة جديدة */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-bold text-slate-800">حركة جديدة (حساب المدير)</h3>
            {/* مصدر الحركة: رصيد مدير معيّن، أو المبلغ الكلي مباشرة بلا مساس بأي مدير */}
          <label className="mb-1 block text-sm font-medium text-slate-700">المصدر / الوجهة</label>
          <select value={txManager} onChange={(e) => setTxManager(e.target.value === "" ? "" : Number(e.target.value))}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500">
            <option value="">💰 المبلغ الكلي مباشرة (بلا مساس بأي مدير)</option>
            {managers.map((m) => <option key={m.id} value={m.id}>👔 رصيد {m.name}</option>)}
          </select>
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
            {/* تعديل يدوي لديون الكارتات: إضافة أو إنقاص (بملاحظة توضّح السبب) */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => submit("card-debt-sub")} disabled={busy} className="rounded-lg border border-mynet-blue/40 bg-blue-50 py-2 text-xs font-semibold text-mynet-blue hover:bg-blue-100 disabled:opacity-60">➖ إنقاص من ديون الكارتات</button>
              <button onClick={() => submit("card-debt-add")} disabled={busy} className="rounded-lg border border-mynet-blue/40 bg-blue-50 py-2 text-xs font-semibold text-mynet-blue hover:bg-blue-100 disabled:opacity-60">➕ إضافة لديون الكارتات</button>
            </div>
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

          {/* المدراء — رصيد كل مدير: ما أودعه في النظام ناقص ما سحبه منه.
              لكل مدير حساب مصروف/مقبوض في كل مكتب (يُنشأ تلقائياً، وفي أي مكتب جديد لاحقاً). */}
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
            <h3 className="mb-1 font-bold text-slate-800">👔 المدراء</h3>
            <p className="mb-3 text-xs text-slate-500">
              رصيد المدير = ما أودعه في النظام − ما سحبه منه (عبر مكاتبه · حسابات المدير · الماستر).
              <span className="block">موجب = <b>له</b> عند الشركة · سالب = <b>عليه</b> لها.</span>
            </p>

            <div className="mb-3 flex flex-wrap gap-2">
              <input value={newMgr} onChange={(e) => setNewMgr(e.target.value)} placeholder="اسم المدير الجديد"
                className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
              <button onClick={addManager} disabled={mgrBusy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
                {mgrBusy ? "..." : "➕ إضافة مدير"}</button>
            </div>
            {mgrMsg && <div className="mb-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">{mgrMsg}</div>}

            {managers.length === 0 ? <div className="text-sm text-slate-400">لا مدراء بعد — أضِف أول مدير.</div> : (
              <div className="space-y-2">
                {managers.map((m) => (
                  <div key={m.id} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                    <div className="flex cursor-pointer flex-wrap items-center justify-between gap-2" onClick={() => setOpenMgr(openMgr === m.id ? null : m.id)}>
                      <span className="font-bold text-slate-800">{m.name}</span>
                      <span className="flex items-center gap-3 text-xs">
                        <span className="text-emerald-600">أودع {fmt(m.deposited)}</span>
                        <span className="text-red-600">سحب {fmt(m.withdrawn)}</span>
                        <b className={m.net < 0 ? "text-red-700" : "text-emerald-700"}>
                          {m.net < 0 ? `عليه ${fmt(-m.net)}` : `له ${fmt(m.net)}`} د.ع
                        </b>
                        <button
                          onClick={(e) => { e.stopPropagation(); openMgrDetail(m.id); }}
                          className="rounded-lg bg-slate-800 px-3 py-1 text-[11px] font-bold text-white hover:bg-slate-900"
                        >تفاصيل</button>
                        <span className="text-slate-400">{openMgr === m.id ? "▲" : "▼"}</span>
                      </span>
                    </div>
                    {openMgr === m.id && (
                      <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
                        {m.byOffice.length === 0 && m.general === 0 && m.master === 0 ? (
                          <div className="text-slate-400">لا حركات بعد</div>
                        ) : (<>
                          {m.byOffice.map((o) => (
                            <div key={o.towerId} className="flex justify-between">
                              <span>🏢 {o.office}</span>
                              <span>أودع {fmt(o.deposited)} · سحب {fmt(o.withdrawn)} · <b>{fmt(o.net)}</b></span>
                            </div>
                          ))}
                          {m.general !== 0 && <div className="flex justify-between"><span>🧾 حسابات المدير</span><b>{fmt(m.general)}</b></div>}
                          {m.master !== 0 && <div className="flex justify-between"><span>🅜 الماستر</span><b>{fmt(m.master)}</b></div>}
                          {m.opening !== 0 && <div className="flex justify-between"><span>📗 رصيد سابق (إكسل)</span><b>{fmt(m.opening)}</b></div>}
                        </>)}
                        <div className="mt-1 text-[11px] text-slate-400">حركات المكاتب تؤثر على تقاريرها اليومية · حسابات المدير والماستر لا تؤثر على أي تقرير.</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* الموظفون — الراتب المتبقي + تفاصيل + تسديد */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-bold text-slate-800">رواتب الموظفين</h3>
            <p className="mb-2 text-xs text-slate-500">الراتب المتبقّي لكل موظف (فني) بعد الحضور والخصومات ضمن الفترة المحدّدة. اضغط «تفاصيل» للكشف، و«تسديد» لصرف راتبه.</p>
            {data.employees.length === 0 ? <div className="text-sm text-slate-400">لا توجد حسابات موظفين</div> : (
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="py-1 text-right font-medium">الموظف</th>
                    <th className="py-1 text-right font-medium">الراتب المتبقّي</th>
                    <th className="py-1 text-right font-medium">ما سحبه</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="py-2 font-medium">{e.name ?? "—"}</td>
                      <td className="py-2 font-bold text-emerald-700">{e.net != null ? `${fmt(e.net)} د.ع` : <span className="text-xs font-normal text-slate-400">حساب غير مرتبط بفني</span>}</td>
                      {/* ما سحبه الموظف: كان يُحسب في الخادم ولا يُعرض في الشاشة إطلاقاً */}
                      <td className="py-2 font-semibold text-red-600">{e.withdrawn ? fmt(e.withdrawn) : "—"}</td>
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

        {/* سجل حركات المدير — مع بحث (كان بلا أي وسيلة للوصول إلى حركة بعينها) */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 p-2">
            <input value={txQ} onChange={(e) => setTxQ(e.target.value)}
              placeholder="🔍 بحث في الحركات: نوع، مبلغ، ملاحظة، أو من سجّلها…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
          </div>
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><th className="p-3">#</th><th className="p-3">التاريخ</th><th className="p-3">النوع</th><th className="p-3">المبلغ</th><th className="p-3">بواسطة</th><th className="p-3">ملاحظة</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {(() => {
                const needle = txQ.trim().toLowerCase();
                const list = needle
                  ? data.transactions.filter((t) =>
                      [TYPE_LABEL[t.type] ?? t.type, String(t.amount), t.notes ?? "", t.byUser ?? "", String(t.id)]
                        .some((v) => v.toLowerCase().includes(needle)))
                  : data.transactions;
                return list.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد حركات مطابقة</td></tr>
              ) : list.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-400">{t.id}</td>
                  <td className="p-3" dir="ltr">{fmtDate(t.date)}</td>
                  <td className="p-3">{TYPE_LABEL[t.type] ?? t.type}</td>
                  <td className={`p-3 font-bold ${t.type === "receipt" || t.type === "master-receipt" ? "text-emerald-600" : "text-red-600"}`}>{fmt(t.amount)}</td>
                  <td className="p-3 font-medium text-slate-700">{t.byUser ?? "—"}</td>
                  <td className="p-3 text-slate-600">{t.notes ?? "—"}</td>
                  <td className="p-3"><button onClick={() => del(t.id)} className="rounded bg-red-50 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-100">حذف</button></td>
                </tr>
              ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* تفاصيل المدير: كل حركاته من كل القنوات — بما فيها ما سجّله المستخدم
          من صفحة المصروفات والمقبوضات على حساب هذا المدير في أي مكتب */}
      {mgrDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMgrDetail(null)}>
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-sky-50 px-4 py-3">
              <div>
                <h3 className="text-lg font-bold text-sky-800">👔 تفاصيل حركات {mgrDetail.manager.name}</h3>
                <p className="text-xs text-slate-500">كل الحركات: مكاتبه (بما سجّله المستخدم في المصروفات والمقبوضات) · حساباته العامة · الماستر · الرصيد السابق</p>
              </div>
              <button onClick={() => setMgrDetail(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            <div className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-white px-4 py-2.5 text-center text-sm">
              <div><div className="text-xs text-slate-500">أودع</div><b className="text-emerald-600">{fmt(mgrDetail.totals.deposited)}</b></div>
              <div><div className="text-xs text-slate-500">سحب</div><b className="text-red-600">{fmt(mgrDetail.totals.withdrawn)}</b></div>
              <div><div className="text-xs text-slate-500">الصافي</div>
                <b className={mgrDetail.totals.net < 0 ? "text-red-700" : "text-emerald-700"}>
                  {mgrDetail.totals.net < 0 ? `عليه ${fmt(-mgrDetail.totals.net)}` : `له ${fmt(mgrDetail.totals.net)}`}
                </b>
              </div>
            </div>

            <div className="border-b border-slate-100 p-2">
              <input value={mgrDetailQ} onChange={(e) => setMgrDetailQ(e.target.value)}
                placeholder="🔍 بحث: مكتب، نوع، مبلغ، ملاحظة، أو من سجّلها…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
            </div>

            <div className="overflow-auto">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr><th className="p-2">التاريخ</th><th className="p-2">المكتب</th><th className="p-2">النوع</th>
                    <th className="p-2">أودع</th><th className="p-2">سحب</th><th className="p-2">الملاحظة</th>
                    <th className="p-2">بواسطة</th>{can("receipts.void") && <th className="p-2"></th>}</tr>
                </thead>
                <tbody>
                  {(() => {
                    const needle = mgrDetailQ.trim().toLowerCase();
                    const list = needle
                      ? mgrDetail.rows.filter((r) =>
                          [r.office ?? "", r.kind, String(r.deposited), String(r.withdrawn), r.notes ?? "", r.by ?? ""]
                            .some((v) => v.toLowerCase().includes(needle)))
                      : mgrDetail.rows;
                    return list.length === 0 ? (
                      <tr><td colSpan={8} className="p-8 text-center text-slate-400">لا حركات مطابقة</td></tr>
                    ) : list.map((r) => (
                      <tr key={r.key} className="border-t border-slate-100">
                        <td className="p-2 whitespace-nowrap text-slate-500" dir="ltr">{fmtDate(r.date)}</td>
                        <td className="p-2 text-slate-500">{r.office ?? "—"}</td>
                        <td className="p-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{r.kind}</span>
                        </td>
                        <td className="p-2 font-bold text-emerald-600">{r.deposited ? fmt(r.deposited) : "—"}</td>
                        <td className="p-2 font-bold text-red-600">{r.withdrawn ? fmt(r.withdrawn) : "—"}</td>
                        <td className="p-2 text-slate-600">{r.notes ?? "—"}</td>
                        <td className="p-2 text-slate-400">{r.by ?? "—"}</td>
                        {can("receipts.void") && (
                          <td className="p-2">
                            <button onClick={() => delMgrRow(r)} className="rounded bg-red-50 px-2 py-1 font-semibold text-red-600 hover:bg-red-100" title="حذف الحركة">🗑</button>
                          </td>
                        )}
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
              حركات المكاتب تؤثر على تقاريرها اليومية (عدا ما وُسِم ماستر) · حساباته العامة والماستر والرصيد السابق لا تؤثر على أي تقرير.
            </div>
          </div>
        </div>
      )}

      {/* تفكيك «المبلغ الكلي الموجود» (المرحلة ٥): أخطر رقم في الصفحة — مكوّناته
          خمسة ولا يظهر منها إلا اثنان، فتُطرح تسديدات الكارتات والرواتب وتُضاف
          مقبوضات الإدارة بصمت ولا سبيل لمعرفة لماذا تغيّر الرقم. */}
      {showTotal && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowTotal(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-emerald-50 px-4 py-3">
              <div>
                <h3 className="text-lg font-bold text-emerald-800">💰 من أين جاء «المبلغ الكلي الموجود»</h3>
                <p className="text-xs text-slate-500">خمسة مكوّنات — اضغط ما هو قابل للفتح منها لترى حركاته</p>
              </div>
              <button onClick={() => setShowTotal(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>
            <table className="w-full text-right text-sm">
              <tbody>
                <tr className="border-b border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => { setShowTotal(false); openDailyLog(); }}>
                  <td className="p-3">مجموع المبالغ اليومية <span className="text-[10px] text-slate-400">(صافي كل تقارير المكاتب) ↗</span></td>
                  <td className="p-3 text-left font-bold text-slate-800">{fmt(data.cumulativeDaily)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="p-3">+ مقبوضات الإدارة <span className="text-[10px] text-slate-400">(قبضٌ في حسابات المدير)</span></td>
                  <td className="p-3 text-left font-bold text-emerald-600">+{fmt(data.managerReceipts)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="p-3">− مصروفات الإدارة</td>
                  <td className="p-3 text-left font-bold text-red-600">−{fmt(data.managerExpenses)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="p-3">− تسديد ديون الكارتات</td>
                  <td className="p-3 text-left font-bold text-red-600">−{fmt(data.cardPayments)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="p-3">− رواتب سُدِّدت من الكلي <span className="text-[10px] text-slate-400">(خارج التقرير اليومي)</span></td>
                  <td className="p-3 text-left font-bold text-red-600">−{fmt(data.salaryFromTotal)}</td>
                </tr>
              </tbody>
              <tfoot className="bg-emerald-50 font-extrabold">
                <tr><td className="p-3">= المبلغ الكلي الموجود</td><td className="p-3 text-left text-emerald-700">{fmt(data.totalAvailable)}</td></tr>
              </tfoot>
            </table>
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
              حساب الماستر خارج هذه المعادلة تماماً — له بطاقته المستقلة.
            </div>
          </div>
        </div>
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
                      {/* أ-٦ · صفُّ اليوم صار قابلاً للضغط ⇒ يفتح **تقرير ذلك اليوم كاملاً**
                          (بلاغ محمد: «أُشاهد مبلغ يومٍ سابقٍ ولا أعرف من أين جاء»). والتقريرُ
                          مقيَّدٌ **باليوم والمكتب المضغوطَين معاً** لا بكلّ مكاتب الوكيل. */}
                      {rows.map((d) => (
                        <tr key={d.day} onClick={() => void openDay(d.day, logOffice === "all" ? null : Number(logOffice))}
                          title="اضغط لعرض تقرير هذا اليوم كاملاً"
                          className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60">
                          <td className="p-3 font-medium" dir="ltr">{d.day} <span className="text-mynet-blue">↗</span></td>
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
                      <tr key={d.day} className="border-t border-slate-100 align-top">
                        <td className="p-3 font-medium" dir="ltr">{d.day}</td>
                        <td className="p-3 text-emerald-600">{d.in ? fmt(d.in) : "—"}</td>
                        <td className="p-3 text-red-600">{d.out ? fmt(d.out) : "—"}</td>
                        <td className={`p-3 font-bold ${d.net >= 0 ? "text-indigo-700" : "text-red-600"}`}>
                          {fmt(d.net)}
                          {/* تفصيل ماستر كل مكتب في هذا اليوم — لا المجموع فقط */}
                          {(d.offices?.length ?? 0) > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {d.offices!.map((o) => (
                                <span key={o.towerId} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                  🏢 {o.name}: {fmt(o.net)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-slate-400">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-indigo-50 font-bold">
                    <tr><td className="p-3">الرصيد الكلي</td><td colSpan={2}></td><td className="p-3 text-indigo-700">{fmt(masterDetail.balance)}</td><td></td></tr>
                  </tfoot>
                </table>
              )}

              {/* الحركات المفردة — المكان الوحيد الذي تُرى فيه حركة ماستر بعينها وتُحذف
                  (صفحة الصندوق تعرض اليدوي فقط، فحركة الماستر كانت تختفي بعد تسجيلها) */}
              {masterDetail && masterDetail.transactions.length > 0 && (
                <div className="border-t-4 border-slate-100">
                  <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">كل حركات الماستر ({masterDetail.transactions.length}) — اضغط 🗑 لحذف حركة خاطئة</div>
                  <table className="w-full text-right text-xs">
                    <tbody>
                      {masterDetail.transactions.map((t) => (
                        <tr key={t.id} className="border-t border-slate-100">
                          <td className="p-2 whitespace-nowrap text-slate-500" dir="ltr">{fmtDate(t.date)}</td>
                          <td className="p-2 text-slate-500">{t.office ?? "—"}</td>
                          <td className="p-2 text-slate-700">{t.notes ?? "—"}</td>
                          <td className="p-2 text-slate-400">{t.by ?? "—"}</td>
                          <td className="p-2 whitespace-nowrap font-bold">
                            {(t.moneyIn ?? 0) > 0 ? <span className="text-emerald-600">+{fmt(t.moneyIn ?? 0)}</span> : <span className="text-red-600">−{fmt(t.moneyOut ?? 0)}</span>}
                          </td>
                          <td className="p-2">
                            {can("receipts.void") && <button onClick={() => delMasterTx(t.id, (t.notes ?? "حركة ماستر") + " — " + fmt((t.moneyIn ?? 0) || (t.moneyOut ?? 0)) + " د.ع")}
                              className="rounded bg-red-50 px-2 py-1 font-semibold text-red-600 hover:bg-red-100" title="حذف الحركة">🗑</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== أ-٦ · نافذةُ تقرير يومٍ سابق (مواصفةُ محمد 2026-08-11) =====
          «نافذةٌ منبثقةٌ كبيرة تعرض تقرير ذلك اليوم كاملاً بكلّ تفاصيله — لا المجموعَ وحده،
          بكتابةٍ كبيرةٍ واضحة، فالغايةُ **المراجعة**. ولا تُغلَق بالضغط على أيّ فراغ» ⇒
          لا `onClick` على الخلفيّة ولا إغلاقٌ بـEsc؛ الإغلاقُ بعلامة ✕ حصراً. */}
      {dayView && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-extrabold text-slate-800">📅 تقرير يوم <span dir="ltr">{dayView.day}</span></h3>
                <div className="mt-1 text-sm text-slate-500">
                  {dayView.towerId == null ? "كلّ المكاتب" : (dailyLog?.offices.find((o) => o.id === dayView.towerId)?.name ?? "المكتب")}
                </div>
              </div>
              <button onClick={() => setDayView(null)} aria-label="إغلاق"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 hover:bg-slate-200">✕</button>
            </div>

            {!dayRep ? (
              <div className="p-10 text-center text-slate-400">جاري الحساب…</div>
            ) : (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  {([
                    ["تفعيل اشتراكات", "activationIn", "activationCount"],
                    ["فاتورة المبيع (المُحصَّل)", "invoiceIn", "invoiceCount"],
                    ["مبيعات المخزن", "salesIn", null],
                    ["المقبوضات (اليوم)", "otherIn", null],
                    ["المصروفات (اليوم)", "expenses", null],
                    ["🅜 حساب الماستر (مستقل)", "masterIn", null],
                  ] as [string, string, string | null][]).map(([label, k, ck]) => (
                    <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm text-slate-600">{label}</div>
                      <div className="text-2xl font-extrabold text-slate-800">{fmt(Number(dayRep[k] ?? 0))}</div>
                      {ck && <div className="mt-0.5 text-xs text-slate-400">عددها {Number(dayRep[ck] ?? 0)}</div>}
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl bg-gradient-to-l from-mynet-blue to-mynet-blue-dark p-5 text-center text-white">
                  <div className="text-sm opacity-85">صافي اليوم (بلا الماستر)</div>
                  <div className="text-4xl font-extrabold">{fmt(Number(dayRep.total ?? 0))} <span className="text-lg font-normal">د.ع</span></div>
                </div>
                <p className="mt-3 text-center text-xs text-slate-400">
                  الأرقامُ محسوبةٌ بنفس دالّة التقرير اليوميّ للشاشة الرئيسيّة — مقيَّدةً بهذا اليوم وهذا المكتب.
                </p>
              </>
            )}
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
