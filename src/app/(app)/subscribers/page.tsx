"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ActivationModal, { type ActSubscriber } from "@/components/ActivationModal";
import AddDebtModal from "@/components/AddDebtModal";
import MapButton from "@/components/MapButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";

type Subscriber = {
  id: number;
  name: string | null;
  phone: string | null;
  address: string | null;
  packageId: number | null;
  towerId: number | null;
  carry: number | null;
  dateTo: string | null;
  netUser: string | null;
  sasId: number | null;
  note: string | null;
  smsEnabled: number | null;
  waEnabled: boolean | null;
  transferredTo: string | null;
  rewardBalance: number | null;
  rewardCode: string | null;
};
type Pkg = { id: number; name: string | null; priceDinar: number | null };
type Tower = { id: number; name: string | null; loginUrl: string | null; activationTemplate: string | null; activationMode: string | null };

// خيارات "عمليات" لكل مشترك — كل خيار يُنشئ بطاقة في عمود بنفس الاسم بلوحة إدارة الفنيين
const FIELD_OPS = [
  { key: "صيانة", icon: "🔧" },
  { key: "اعادة", icon: "🔁" },
  { key: "توصيل", icon: "🔌" },
  { key: "تحويل", icon: "↪️" },
] as const;

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
// الأيام المتبقية — تُحسب بفرق أيام التقويم (منتصف الليل)، فتنقص يوماً بالضبط عند بداية كل يوم جديد
const daysLeft = (dateTo: string | null) => {
  if (!dateTo) return 0;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dt = new Date(dateTo);
  const expMid = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.round((expMid - todayMid) / 86400000);
};

type Receipt = {
  id: number;
  date: string | null;
  dateTo: string | null;
  money: number | null;
  moneyIn: number | null;
  moneyCarry: number | null;
  cardType: string | null;
  month: string | null;
};

export default function SubscribersPage() {
  const router = useRouter();
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0); // مجموع المطابقين (قد يفوق المعروض 300)
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Subscriber>>({});
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"info" | "receipts" | "invoices" | "maintenance">("info");
  const [maintLogs, setMaintLogs] = useState<{ id: number; details: string; technicianName: string | null; kind: string | null; durationSec: number | null; amount: number | null; date: string }[]>([]);
  const [activating, setActivating] = useState<Subscriber | null>(null);
  const [addingDebt, setAddingDebt] = useState<Subscriber | null>(null);
  const [showAllTowers, setShowAllTowers] = useState(false);
  const [msg, setMsg] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [delMenu, setDelMenu] = useState(false);
  // عرض الهاتف: القائمة أو تفاصيل المشترك (على الكمبيوتر تظهر كلها معاً)
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  // تنبيه واتساب: يظهر عند فتح مشترك لا يملك رقماً، أو رقمه بعدد خاطئ، أو لا واتساب عليه (تنبيه بحت)
  const [waNotice, setWaNotice] = useState<"no-phone" | "bad-phone" | "no-whatsapp" | null>(null);
  const waCheckId = useRef<number | null>(null); // آخر مشترك طُلب فحصه (لتجاهل النتائج المتأخّرة)
  // قائمة عمليات المشترك (ربط بلوحة إدارة الفنيين)
  const [opsSub, setOpsSub] = useState<Subscriber | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsMsg, setOpsMsg] = useState("");
  const [opsChosen, setOpsChosen] = useState<string | null>(null); // العملية المختارة (تُفتح نافذة الهاتف/الملاحظة)
  const [opsPhone, setOpsPhone] = useState(""); // رقم هاتف إضافي (اختياري)
  const [opsNote, setOpsNote] = useState(""); // ملاحظة (اختيارية)

  function closeOps() { setOpsSub(null); setOpsChosen(null); setOpsPhone(""); setOpsNote(""); }

  // إرسال المشترك كبطاقة إلى عمود العملية — مع الهاتف الإضافي والملاحظة (إن كُتبا)
  async function sendToField(operation: string) {
    if (!opsSub) return;
    setOpsBusy(true); setOpsMsg("");
    const res = await fetch("/api/field/from-subscriber", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriberId: opsSub.id, operation, extraPhone: opsPhone.trim() || undefined, note: opsNote.trim() || undefined }),
    });
    setOpsBusy(false);
    if (res.ok) { setOpsMsg(`✓ تمت إضافة «${opsSub.name ?? ""}» إلى عمود «${operation}» في إدارة الفنيين`); closeOps(); }
    else { const d = await res.json().catch(() => ({})); setOpsMsg(d.error ?? "تعذّرت الإضافة"); }
  }

  function toggleCheck(id: number) {
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleCheckAll() {
    setChecked((s) => (s.size === subs.length ? new Set() : new Set(subs.map((x) => x.id))));
  }
  async function deleteCurrentList() {
    // حذف المحدّدين، وإن لم يُحدَّد أحد فالقائمة المعروضة حالياً
    const ids = checked.size > 0 ? [...checked] : subs.map((s) => s.id);
    if (ids.length === 0) return;
    if (!confirm(`حذف ${ids.length} مشترك من القائمة الحالية؟`)) return;
    await fetch("/api/subscribers/bulk-delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
    });
    setChecked(new Set()); setDelMenu(false); newRecord(); load(query, showAllTowers);
  }
  async function deleteAllSubs() {
    if (!confirm("⚠️ حذف جميع المشتركين نهائياً؟")) return;
    if (!confirm("تأكيد أخير: حذف الكل؟")) return;
    await fetch("/api/subscribers/bulk-delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }),
    });
    setChecked(new Set()); setDelMenu(false); newRecord(); load(query, showAllTowers);
  }

  const { can } = usePermission();

  // جلب سجل وصولات المشترك المحدّد
  const loadReceipts = useCallback(() => {
    if (!selectedId) { setReceipts([]); return; }
    fetch(`/api/subscriptions?subscriberId=${selectedId}`).then((r) => {
      if (r.ok) r.json().then(setReceipts);
    });
  }, [selectedId]);
  useEffect(() => { loadReceipts(); }, [loadReceipts]);

  // جلب سجل صيانات المشترك المحدّد
  useEffect(() => {
    if (!selectedId) { setMaintLogs([]); return; }
    fetch(`/api/subscribers/${selectedId}/maintenance`).then((r) => {
      if (r.ok) r.json().then((d) => setMaintLogs(d.logs ?? []));
    });
  }, [selectedId]);

  // حذف وصل تفعيل عكسياً من سجل وصولات المشترك
  async function voidReceipt(id: number) {
    if (!window.confirm("حذف هذا الوصل عكسياً؟\nسيرجع المشترك لحالته قبل الوصل (تُلغى الأيام والمبلغ ويُرجَع الكارت).")) return;
    const res = await fetch(`/api/subscription-entries/${id}/void`, { method: "POST" });
    if (res.ok) { loadReceipts(); load(query, showAllTowers); }
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }

  // مسح كود ورصيد مكافأة المشترك المحدّد يدوياً
  async function clearReward() {
    if (!selected) return;
    if (!confirm(`مسح كود ورصيد مكافأة «${selected.name ?? ""}» نهائياً؟`)) return;
    const res = await fetch("/api/rewards/clear", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriberId: selected.id }),
    });
    if (res.ok) { load(query, showAllTowers); }
    else { const d = await res.json().catch(() => ({})); alert(d.error ?? "تعذّر مسح الكود"); }
  }

  const load = useCallback((q = "", all = false) => {
    fetch(`/api/subscribers?q=${encodeURIComponent(q)}${all ? "&all=1" : ""}`).then((r) => {
      if (!r.ok) return;
      const t = Number(r.headers.get("X-Total-Count"));
      setTotal(Number.isFinite(t) ? t : 0);
      r.json().then(setSubs);
    });
  }, []);

  useEffect(() => {
    fetch("/api/packages").then((r) => void (r.ok && r.json().then(setPackages)));
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setTowers)));
  }, []);

  // بحث تلقائي أثناء الكتابة + إعادة الجلب عند تبديل عرض المكاتب
  useEffect(() => {
    const t = setTimeout(() => load(query, showAllTowers), 250);
    return () => clearTimeout(t);
  }, [query, showAllTowers, load]);

  const towerName = (id: number | null | undefined) => towers.find((t) => t.id === id)?.name ?? "—";
  const selected = subs.find((s) => s.id === selectedId) ?? null;

  function selectRow(s: Subscriber) {
    setSelectedId(s.id);
    setForm({ ...s });
    setEditing(false);
    setMsg("");
    setMobilePane("detail"); // على الهاتف: الانتقال لتفاصيل المشترك عند اختياره
    checkWhatsApp(s); // تنبيه إن كان المشترك بلا رقم أو بلا واتساب — يظهر كل مرة يُفتَح
  }

  // فحص واتساب المشترك عند فتحه (تنبيه بحت، لا يؤثر على أي عملية).
  // يظهر التنبيه في كل مرة يُضغط المشترك، ويختفي عند تبديل الرقم أو توفّر واتساب.
  //   - لا رقم                     → تنبيه فوراً (بلا حاجة لواتساب)
  //   - رقم بعدد خاطئ (ليس 10 ولا 11) → تنبيه فوراً (بلا حاجة لواتساب)
  //   - رقم صحيح بلا واتساب عليه     → تنبيه (يتطلّب واتساب المكتب متصلاً)
  function checkWhatsApp(s: Subscriber) {
    setWaNotice(null);
    waCheckId.current = s.id;
    const digits = (s.phone ?? "").replace(/\D/g, "");
    if (digits.length === 0) { setWaNotice("no-phone"); return; }
    if (digits.length !== 10 && digits.length !== 11) { setWaNotice("bad-phone"); return; }
    // الرقم بطول صحيح → افحص وجود واتساب عليه (يحتاج واتساب المكتب متصلاً)
    fetch(`/api/whatsapp/subscriber-check?subscriberId=${s.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // نتجاهل النتيجة إن تغيّر المشترك المختار أثناء الفحص
        if (!d || waCheckId.current !== s.id) return;
        if (d.status === "no-whatsapp") setWaNotice("no-whatsapp");
      })
      .catch(() => { /* تجاهل — تنبيه فقط */ });
  }
  function newRecord() {
    setSelectedId(null);
    setForm({ waEnabled: true }); // واتساب مفعّل افتراضياً للمشترك الجديد
    setEditing(true);
    setMsg("");
    setMobilePane("detail");
  }
  const set = (k: keyof Subscriber, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name?.trim()) { setMsg("الاسم مطلوب"); return; }
    const res = await fetch(
      selectedId ? `/api/subscribers/${selectedId}` : "/api/subscribers",
      { method: selectedId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) },
    );
    if (res.ok) {
      const saved = await res.json();
      setMsg("✓ تم الحفظ");
      setEditing(false);
      setSelectedId(saved.id);
      load(query, showAllTowers);
      checkWhatsApp({ ...(form as Subscriber), id: saved.id }); // إعادة فحص واتساب بعد التعديل (مثلاً عند تبديل الرقم)
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "فشل الحفظ");
    }
  }
  const remaining = useMemo(() => daysLeft(form.dateTo ?? null), [form.dateTo]);
  const serviceActive = remaining > 0;
  const ro = !editing; // للقراءة فقط

  return (
    <div className="flex h-[calc(100dvh-52px)] flex-col bg-[#eef3f8] text-slate-800 md:h-screen">
      {/* شريط الأدوات — يمرّر أفقياً على الهاتف */}
      <div className="flex items-stretch gap-1 overflow-x-auto border-b border-slate-300 bg-gradient-to-b from-white to-slate-100 px-2 py-1">
        <ToolGroup title="الرئيسية">
          <ToolBtn icon="🏠" label="الصفحة الرئيسية" onClick={() => router.push("/dashboard")} />
        </ToolGroup>
        <ToolGroup title="العمليات الاساسية">
          <ToolBtn icon="🗎" label="جديد" onClick={newRecord} />
          <ToolBtn icon="✏️" label="تعديل" onClick={() => selected && setEditing(true)} disabled={!selected} />
          <ToolBtn icon="💾" label="حفظ" onClick={save} disabled={!editing} />
          {can("subscribers.delete") && <ToolBtn icon="🗑️" label="حذف" onClick={() => setDelMenu(true)} />}
        </ToolGroup>
        <ToolGroup title=" ">
          <ToolBtn icon="📝" label="اضافة مذكرة" onClick={() => router.push("/tickets")} />
        </ToolGroup>
        <ToolGroup title="الاشتراكات">
          <ToolBtn icon="📊" label="تقارير الوصولات + الديون" onClick={() => router.push("/reports/detailed")} />
          <ToolBtn icon="💵" label="تسديد اشتراك" onClick={() => router.push("/debts")} />
          <ToolBtn icon="🅰️" label="اضافة ديون سابقة" danger onClick={() => selected && setAddingDebt(selected)} disabled={!selected} />
          {can("rewards.clear") && <ToolBtn icon="🎁" label="مسح كود المكافأة" danger onClick={clearReward} disabled={!selected} />}
        </ToolGroup>
        <ToolGroup title="فاتورة مبيع">
          <ToolBtn icon="🧾" label="انشاء فاتورة" onClick={() => router.push("/invoices")} />
          <ToolBtn icon="💲" label="تسديد فواتير" onClick={() => router.push("/debts")} />
          <ToolBtn icon="🔍" label="تقرير الفواتير" onClick={() => router.push("/reports/invoices")} />
        </ToolGroup>
        <ToolGroup title="الاعدادات">
          <ToolBtn icon="⬇️" label="استيراد من SAS4" onClick={() => router.push("/subscribers/sas4")} />
        </ToolGroup>
        <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-700">
          <input type="checkbox" checked={showAllTowers} onChange={(e) => setShowAllTowers(e.target.checked)} />
          عرض جميع المشتركين من كل المكاتب
        </label>
      </div>

      {/* التبويبات */}
      <div className="flex justify-end gap-1 border-b border-slate-300 bg-slate-50 px-2 pt-1">
        <Tab active={tab === "invoices"} onClick={() => setTab("invoices")}>وصولات الفواتير</Tab>
        <Tab active={tab === "maintenance"} onClick={() => setTab("maintenance")}>🛠️ سجل الصيانات</Tab>
        <Tab active={tab === "receipts"} onClick={() => setTab("receipts")}>سجل وصولات المشترك</Tab>
        <Tab active={tab === "info"} onClick={() => setTab("info")}>👤 بيانات المشترك</Tab>
      </div>

      {/* مبدّل الهاتف: القائمة / تفاصيل المشترك (يظهر على الهاتف فقط) */}
      <div className="flex gap-1 border-b border-slate-200 bg-white px-2 py-1.5 md:hidden">
        <button
          onClick={() => setMobilePane("list")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${mobilePane === "list" ? "bg-mynet-blue text-white shadow" : "bg-slate-100 text-slate-600"}`}
        >
          📋 قائمة المشتركين
        </button>
        <button
          onClick={() => setMobilePane("detail")}
          className={`flex-1 truncate rounded-lg px-2 py-2 text-sm font-semibold transition ${mobilePane === "detail" ? "bg-mynet-blue text-white shadow" : "bg-slate-100 text-slate-600"}`}
        >
          👤 {selected ? selected.name : "التفاصيل"}
        </button>
      </div>

      {/* الجسم: 3 لوحات (كمبيوتر) / لوحة واحدة بالتبديل (هاتف) */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 md:flex-row md:overflow-hidden">
        {tab !== "info" ? (
          /* سجل وصولات المشترك / وصولات الفواتير */
          <section className={`${mobilePane === "detail" ? "flex" : "hidden"} w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white md:flex md:w-[640px]`}>
            <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-500">
              {tab === "receipts" ? "سجل وصولات المشترك (التفعيلات السابقة)" : tab === "maintenance" ? "سجل صيانات المشترك" : "وصولات الفواتير"}
              {selected && <span className="mr-2 text-slate-700"> — {selected.name}</span>}
            </div>
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">اختر مشتركاً من القائمة</div>
            ) : tab === "receipts" ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2">#</th><th className="p-2">التاريخ والوقت</th><th className="p-2">الباقة</th>
                      <th className="p-2">أشهر</th><th className="p-2">القيمة</th><th className="p-2">الواصل</th>
                      <th className="p-2">الدين</th><th className="p-2">ينتهي</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.length === 0 ? (
                      <tr><td colSpan={9} className="p-6 text-center text-slate-400">لا توجد وصولات لهذا المشترك</td></tr>
                    ) : receipts.map((rc) => (
                      <tr key={rc.id} className="border-t border-slate-100">
                        <td className="p-2 text-slate-400">{rc.id}</td>
                        <td className="p-2" dir="ltr">{formatDateTime(rc.date)}</td>
                        <td className="p-2">{rc.cardType ?? "—"}</td>
                        <td className="p-2">{rc.month ?? "—"}</td>
                        <td className="p-2">{fmt(rc.money)}</td>
                        <td className="p-2 text-emerald-600">{fmt(rc.moneyIn)}</td>
                        <td className="p-2 text-red-600">{fmt(rc.moneyCarry)}</td>
                        <td className="p-2" dir="ltr">{formatDate(rc.dateTo)}</td>
                        <td className="p-2">
                          <div className="flex gap-1.5">
                            <a href={`/subscriptions/${rc.id}/receipt`} target="_blank" rel="noopener noreferrer" className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100" title="إعادة طباعة الوصل">🖨 طباعة</a>
                            {can("receipts.void") && (
                              <button onClick={() => voidReceipt(rc.id)} className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100" title="حذف عكسي">🗑</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : tab === "maintenance" ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr><th className="p-2">التاريخ والوقت</th><th className="p-2">النوع</th><th className="p-2">التفاصيل</th><th className="p-2">المبلغ</th><th className="p-2">الفني</th><th className="p-2">المدة</th></tr>
                  </thead>
                  <tbody>
                    {maintLogs.length === 0 ? (
                      <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد صيانات لهذا المشترك</td></tr>
                    ) : maintLogs.map((m) => (
                      <tr key={m.id} className="border-t border-slate-100 align-top">
                        <td className="p-2 whitespace-nowrap" dir="ltr">{new Date(m.date).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="p-2 whitespace-nowrap">{m.kind ?? "صيانة"}</td>
                        <td className="p-2 text-slate-700">{m.details}</td>
                        <td className="p-2 whitespace-nowrap font-semibold text-emerald-700">{m.amount != null ? Number(m.amount).toLocaleString("en-US") : "—"}</td>
                        <td className="p-2 whitespace-nowrap text-slate-500">{m.technicianName ?? "—"}</td>
                        <td className="p-2 whitespace-nowrap text-slate-500">{m.durationSec != null ? (m.durationSec >= 3600 ? `${Math.floor(m.durationSec / 3600)}س ${Math.floor((m.durationSec % 3600) / 60)}د` : m.durationSec >= 60 ? `${Math.floor(m.durationSec / 60)}د` : `${m.durationSec}ث`) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">وصولات الفواتير — قريباً</div>
            )}
          </section>
        ) : (
        <>
        {/* يمين: اضافة المعلومات */}
        <section className={`${mobilePane === "detail" ? "flex" : "hidden"} w-full shrink-0 flex-col rounded-lg border border-slate-300 bg-white p-3 md:flex md:w-[380px] md:overflow-y-auto`}>
          <div className="mb-2 rounded bg-slate-100 px-2 py-1 text-center text-xs font-bold text-slate-500">
            {editing ? (selectedId ? "تعديل بيانات المشترك" : "إضافة مشترك جديد") : "بيانات المشترك"}
          </div>
          <Row label="الاسم"><Inp v={form.name} onChange={(v) => set("name", v)} ro={ro} /></Row>
          <Row label="اليوزر"><Inp v={form.netUser} onChange={(v) => set("netUser", v)} dir="ltr" ro={ro} /></Row>
          <Row label="الهاتف"><Inp v={form.phone} onChange={(v) => set("phone", v)} dir="ltr" ro={ro} /></Row>
          <Row label="المكتب">
            <select value={form.towerId ?? ""} disabled={ro} onChange={(e) => set("towerId", Number(e.target.value) || null)} className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500">
              <option value="">—</option>
              {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Row>
          <Row label="فئة الاشتراك">
            <select value={form.packageId ?? ""} disabled={ro} onChange={(e) => set("packageId", Number(e.target.value) || null)} className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500">
              <option value="">—</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Row>
          <Row label="العنوان"><Inp v={form.address} onChange={(v) => set("address", v)} ro={ro} /></Row>
          <Row label="ملاحظات">
            <textarea value={form.note ?? ""} disabled={ro} onChange={(e) => set("note", e.target.value)} rows={2} className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500" />
          </Row>
          <Row label="مبلغ التفعيل">
            <div className="rounded bg-slate-50 px-2 py-1 text-sm font-bold text-slate-600">{fmt(packages.find((p) => p.id === form.packageId)?.priceDinar ?? 0)}</div>
          </Row>
          <Row label="واتساب">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" disabled={ro} checked={form.waEnabled !== false} onChange={(e) => set("waEnabled", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              استلام رسائل واتساب
            </label>
          </Row>

          {msg &&<div className="mt-2 rounded bg-blue-50 px-2 py-1 text-center text-xs text-blue-700">{msg}</div>}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => selected && router.push(`/messages/compose?subscriberId=${selected.id}`)} disabled={!selected} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
              <span>💬</span> ارسال ملخص
            </button>
            {selected && <MapButton subscriberId={selected.id} />}
          </div>
        </section>

        {/* وسط: بيانات الاشتراك */}
        <section className={`${mobilePane === "detail" ? "flex" : "hidden"} w-full shrink-0 flex-col gap-2 rounded-lg border border-slate-300 bg-white p-3 md:flex md:w-[240px] md:overflow-y-auto`}>
          <div className="rounded bg-slate-100 px-2 py-1 text-center text-xs font-bold text-slate-500">بيانات الاشتراك</div>
          <div className={`rounded px-2 py-2 text-center text-sm font-bold ${serviceActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
            حالة الخدمة : {serviceActive ? "فعالة" : (selectedId ? "منتهية" : "—")}
          </div>
          <Box label="تاريخ الانتهاء" value={formatDate(form.dateTo)} />
          {/* زر تفعيل واضح تحت تاريخ الانتهاء مباشرةً */}
          <button
            onClick={() => selected && setActivating(selected)}
            disabled={!selected}
            className="w-full rounded-lg bg-emerald-600 py-3 text-base font-extrabold text-white shadow hover:bg-emerald-700 disabled:opacity-40"
          >
            ✅ تفعيل الاشتراك
          </button>
          <BigStat label="ديون الاشتراكات" value={fmt(form.carry)} color="text-red-600" />
          {/* الايام المتبقية: أخضر إن ≥ 0، أحمر إن سالب */}
          <div className={`flex items-center justify-between rounded px-3 py-2 ${remaining >= 0 ? "bg-emerald-500" : "bg-red-600"}`}>
            <span className="text-xs font-semibold text-white">الايام المتبقية للاشتراك</span>
            <span className="text-2xl font-extrabold text-white">{remaining}</span>
          </div>
          <BigStat label="ديون الفواتير" value="0" color="text-amber-600" />
          {/* رصيد كود الخصم (المكافآت) — كم لدى المشترك من رصيد قابل للاستخدام */}
          <BigStat label="رصيد كود الخصم" value={fmt(selected?.rewardBalance)} color="text-fuchsia-600" />
          <button onClick={() => selected?.phone && window.open(`https://wa.me/${selected.phone}`, "_blank")} disabled={!selected?.phone} className="mt-auto rounded border border-slate-300 bg-slate-50 px-2 py-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            فتح المحادثة
          </button>
        </section>
        </>
        )}

        {/* يسار: البحث + الجدول */}
        <section className={`${mobilePane === "list" ? "flex" : "hidden"} flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white md:flex`}>
          <div className="flex items-center gap-1 border-b border-slate-200 p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(query, showAllTowers)}
              placeholder="بحث بالاسم أو رقم الهاتف أو اليوزر أو اسم المكتب"
              className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-mynet-blue"
            />
            <button onClick={() => load(query, showAllTowers)} className="rounded bg-mynet-blue px-3 py-1.5 text-white">🔍</button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-2"><input type="checkbox" checked={subs.length > 0 && checked.size === subs.length} onChange={toggleCheckAll} /></th>
                  <th className="hidden p-2 sm:table-cell">ت</th>
                  <th className="p-2">اسم المشترك</th>
                  <th className="p-2">عمليات</th>
                  <th className="hidden p-2 sm:table-cell">اليوزر</th>
                  <th className="p-2">رقم الهاتف</th>
                  <th className="hidden p-2 sm:table-cell">المكتب</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s, i) => (
                  <tr
                    key={s.id}
                    onClick={() => selectRow(s)}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${selectedId === s.id ? "bg-blue-100" : ""}`}
                  >
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} />
                    </td>
                    <td className="hidden p-2 text-slate-400 sm:table-cell">{i + 1}</td>
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setOpsSub(s); setOpsMsg(""); }}
                        className="whitespace-nowrap rounded-lg border border-mynet-blue/30 bg-mynet-blue/5 px-2.5 py-1 text-[11px] font-semibold text-mynet-blue hover:bg-mynet-blue/10"
                      >
                        عمليات ▾
                      </button>
                    </td>
                    <td className="hidden p-2 sm:table-cell" dir="ltr">{s.netUser ?? "—"}</td>
                    <td className="p-2" dir="ltr">{s.phone ?? "—"}</td>
                    <td className="hidden p-2 sm:table-cell">{towerName(s.towerId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-600">
            <span>{total > subs.length ? `عرض ${subs.length} من ${total}` : subs.length}</span>
            {total > subs.length && <span className="text-xs font-normal text-amber-600">🔍 اكتب في البحث لإيجاد الباقي</span>}
          </div>
        </section>
      </div>

      {/* خيارات الحذف */}
      {delMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDelMenu(false)}>
          <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-center text-lg font-bold text-slate-800">حذف المشتركين</h3>
            <button onClick={deleteCurrentList} className="mb-2 w-full rounded-lg bg-red-600 py-3 font-semibold text-white hover:bg-red-700">
              🗑️ حذف القائمة الحالية
              <span className="block text-xs font-normal opacity-90">
                {checked.size > 0 ? `المحدّدون: ${checked.size}` : `المعروضون الآن: ${subs.length}`}
              </span>
            </button>
            <button onClick={deleteAllSubs} className="mb-3 w-full rounded-lg border border-red-300 bg-red-50 py-3 font-semibold text-red-700 hover:bg-red-100">
              حذف جميع المشتركين
              <span className="block text-xs font-normal opacity-80">كل المشتركين في قاعدة البيانات</span>
            </button>
            <button onClick={() => setDelMenu(false)} className="w-full rounded-lg bg-slate-100 py-2 text-slate-600 hover:bg-slate-200">إلغاء</button>
          </div>
        </div>
      )}

      {/* تنبيه واتساب — إشعار كبير وسط الشاشة، يتكرر كل ضغطة على المشترك (تنبيه بحت) */}
      {selected && waNotice && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4" onClick={() => setWaNotice(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-7 text-center shadow-2xl`}
          >
            <div className={`mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full text-5xl ${waNotice === "no-whatsapp" ? "bg-red-100" : "bg-amber-100"}`}>
              {waNotice === "no-whatsapp" ? "⚠️" : "📵"}
            </div>
            <h2 className={`mb-2 text-2xl font-extrabold ${waNotice === "no-whatsapp" ? "text-red-700" : "text-amber-700"}`}>تنبيه واتساب</h2>
            <p className="mb-1 text-lg font-bold text-slate-800">المشترك «{selected.name ?? "—"}»</p>
            <p className="mb-1 text-base text-slate-600">
              {waNotice === "no-phone"
                ? "لا يملك رقم هاتف"
                : waNotice === "bad-phone"
                ? `رقم هاتفه غير صحيح (${(selected.phone ?? "").replace(/\D/g, "").length} أرقام — يجب أن يكون ١٠ أو ١١)`
                : "لا يملك واتساب على رقمه"}
            </p>
            <p className="mb-5 text-sm text-slate-400">لن تصله رسائل واتساب.</p>
            <button onClick={() => setWaNotice(null)} className="w-full rounded-xl bg-mynet-blue py-3 text-lg font-bold text-white hover:bg-mynet-blue-dark">حسناً</button>
          </div>
        </div>
      )}

      {/* قائمة عمليات المشترك → إضافة بطاقة في لوحة إدارة الفنيين */}
      {opsSub && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={closeOps}>
          <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-center text-lg font-bold text-slate-800">عمليات المشترك</div>
            <div className="mb-4 text-center text-sm text-slate-500">{opsSub.name ?? opsSub.netUser ?? `مشترك #${opsSub.id}`}</div>

            {!opsChosen ? (
              // الخطوة 1: اختيار نوع العملية
              <>
                <div className="grid grid-cols-2 gap-2">
                  {FIELD_OPS.map((op) => (
                    <button
                      key={op.key}
                      disabled={opsBusy}
                      onClick={() => { setOpsChosen(op.key); setOpsPhone(""); setOpsNote(""); }}
                      className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 py-4 font-semibold text-slate-700 hover:border-mynet-blue hover:bg-blue-50 disabled:opacity-50"
                    >
                      <span className="text-2xl">{op.icon}</span>
                      <span>{op.key}</span>
                    </button>
                  ))}
                </div>
                <button onClick={closeOps} className="mt-4 w-full rounded-lg bg-slate-100 py-2 text-slate-600 hover:bg-slate-200">إلغاء</button>
              </>
            ) : (
              // الخطوة 2: هاتف إضافي + ملاحظة (اختياريان) — الفراغ يُنشئ البطاقة كالمعتاد
              <>
                <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-center text-sm font-semibold text-mynet-blue">
                  {FIELD_OPS.find((o) => o.key === opsChosen)?.icon} {opsChosen}
                </div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">رقم هاتف إضافي (اختياري)</label>
                <input value={opsPhone} onChange={(e) => setOpsPhone(e.target.value)} dir="ltr" placeholder={opsSub.phone ? `الأصلي: ${opsSub.phone}` : "07..."} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
                <label className="mb-1 block text-xs font-semibold text-slate-500">ملاحظة (اختيارية)</label>
                <textarea value={opsNote} onChange={(e) => setOpsNote(e.target.value)} rows={3} placeholder="تفاصيل أو ملاحظة للفني..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
                <p className="mb-3 text-[11px] text-slate-400">تُضاف مع رقم المشترك الأصلي إلى البطاقة. اتركها فارغة واضغط موافق لإنشاء البطاقة كالمعتاد.</p>
                <div className="flex gap-2">
                  <button onClick={() => sendToField(opsChosen)} disabled={opsBusy} className="flex-1 rounded-lg bg-mynet-blue py-2.5 font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-50">{opsBusy ? "..." : "موافق"}</button>
                  <button onClick={() => setOpsChosen(null)} disabled={opsBusy} className="rounded-lg bg-slate-100 px-4 py-2.5 font-semibold text-slate-600 hover:bg-slate-200">رجوع</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* نتيجة العملية — إشعار (أخضر للنجاح، كهرماني للتحذير/الخطأ مثل «بطاقة مرفوعة») */}
      {opsMsg && (() => {
        const ok = opsMsg.startsWith("✓");
        return (
          <div className="pointer-events-none fixed inset-x-0 top-3 z-[75] flex justify-center px-3">
            <div className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-2xl ${ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-400 bg-amber-50 text-amber-900"}`}>
              <span className="flex-1 whitespace-pre-line leading-relaxed">{opsMsg}</span>
              <button onClick={() => setOpsMsg("")} className="shrink-0 rounded-full px-2 text-lg leading-none text-slate-400 hover:bg-black/10" title="إغلاق">✕</button>
            </div>
          </div>
        );
      })()}

      {activating && (
        <ActivationModal
          subscriber={activating as ActSubscriber}
          packages={packages}
          tower={towers.find((t) => t.id === activating.towerId)}
          onClose={() => setActivating(null)}
          onDone={() => { setActivating(null); load(query, showAllTowers); }}
        />
      )}

      {addingDebt && (
        <AddDebtModal
          subscriber={{ id: addingDebt.id, name: addingDebt.name ?? null, netUser: addingDebt.netUser ?? null, carry: addingDebt.carry ?? null }}
          onClose={() => setAddingDebt(null)}
          onDone={() => { setAddingDebt(null); loadReceipts(); load(query, showAllTowers); }}
        />
      )}
    </div>
  );
}

/* ===== عناصر واجهة ===== */
function ToolGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white px-2.5 pb-1.5 pt-2 shadow-sm">
      <div className="flex flex-1 items-stretch gap-1">{children}</div>
      <span className="mt-1 rounded-full bg-slate-100 py-0.5 text-center text-[11px] font-semibold text-slate-500">{title}</span>
    </div>
  );
}
function ToolBtn({ icon, label, onClick, highlight, danger, disabled }: { icon: string; label: string; onClick?: () => void; highlight?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex w-[74px] flex-col items-center justify-start gap-1.5 rounded-xl px-1 py-2 text-center text-xs font-medium leading-tight transition ${
        disabled ? "cursor-not-allowed text-slate-300" : "text-slate-700 hover:-translate-y-0.5 hover:bg-blue-50 hover:text-mynet-blue"
      }`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-[22px] leading-none ${highlight ? "bg-emerald-100" : danger ? "bg-red-100" : "bg-slate-50"}`}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-t-lg border border-b-0 px-4 py-1.5 text-sm font-semibold ${active ? "border-slate-300 bg-white text-mynet-blue" : "border-transparent bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
      {children}
    </button>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <label className="w-24 shrink-0 text-left text-xs font-semibold text-slate-600">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
function Inp({ v, onChange, dir, ro }: { v?: string | null; onChange: (v: string) => void; dir?: string; ro?: boolean }) {
  return <input value={v ?? ""} dir={dir} disabled={ro} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-mynet-blue disabled:bg-slate-50 disabled:text-slate-500" />;
}
function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2 text-center">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-700">{value}</div>
    </div>
  );
}
function BigStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <span className={`text-xl font-extrabold ${color}`}>{value}</span>
    </div>
  );
}
