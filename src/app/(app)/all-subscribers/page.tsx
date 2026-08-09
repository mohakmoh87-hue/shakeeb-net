"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";
import { formatDate } from "@/lib/format";

// ===== صفحة «كلّ المشتركين» (طلب محمد 2026-08-09) — تُفتح من مربّع المشتركين بالرئيسيّة =====
// قائمة كلّ المشتركين (كلّ مكتبٍ بمكتبه، والمدير يرى الكلّ) + تحديد بمربّعات + تحديد الكلّ،
// وفلاتر: ينتهي خلال ١/٢/٣ أيّام أو إلى تاريخ · فعّال/متصل/منتهي/الكل · منتهون بين تاريخين · بحث،
// وإرسالُ رسالةٍ للمحدَّدين، وطباعةُ وصولاتهم بقالب «وصل المشترك» الخاصّ.
type Row = {
  id: number; name: string | null; phone: string | null; address: string | null; netUser: string | null;
  dateTo: string | null; carry: number; waEnabled: boolean; office: string | null; towerId: number | null;
  packageName: string | null; price: number; online: boolean | null;
};
type Office = { id: number; name: string | null };
// القوالب الفعّالة من /api/sms-templates/effective: نصّ المكتب ← الوكيل ← الافتراضيّ،
// زائداً القوالب الحرّة. (قراءة صفوف القاعدة وحدها كانت تُظهر القائمة فارغة — بلاغ محمد.)
type Tpl = { key: string; type: string; text: string; scope: "office" | "agent" | "default" | "custom" };
const SCOPE_TAG: Record<string, string> = { office: " — قالب المكتب", agent: " — قالب الوكيل", default: " — افتراضيّ", custom: "" };

// الأسماء العربيّة للقوالب التلقائيّة (كما في صفحة إدارة القوالب) — وما ليس منها فهو قالبٌ حرّ
// أنشأه المدير باسمه، فيُعرض اسمه كما هو.
const TPL_NAMES: Record<string, string> = {
  activation: "تفعيل الاشتراك", expiring: "تذكير قبل الانتهاء", debtPaid: "تسديد دين",
  debts: "مطالبة بالديون", maintenance: "الصيانة/التنصيب", reward: "منح المكافأة",
  rewardUsed: "استخدام المكافأة", subSummary: "ملخص الاشتراك (وصل)", noAnswer: "ميجاوب (لم يرد)",
  loan: "قرض فزعة", other: "أخرى (عام)",
};

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));

export default function AllSubscribersPage() {
  const { can, me } = usePermission();
  const sp = useSearchParams();

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [offices, setOffices] = useState<Office[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  // الفلاتر
  const [office, setOffice] = useState<string>(sp.get("office") ?? "all");
  const [status, setStatus] = useState<"all" | "active" | "online" | "expired">("all");
  const [days, setDays] = useState<string>(""); // "" | "1" | "2" | "3"
  const [until, setUntil] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  // إرسال رسالة
  const [sendOpen, setSendOpen] = useState(false);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tplErr, setTplErr] = useState(""); // سببُ عدم ظهور القوالب (يُعرَض بدل الصمت)
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // القوالب الفعّالة — تُجلب لمكتب العرض (تخصيص المكتب يغلب قالب الوكيل)
  const loadTpls = useCallback(() => {
    const qs = office !== "all" ? `?officeId=${office}` : "";
    setTplErr("");
    fetch(`/api/sms-templates/effective${qs}`)
      .then(async (r) => {
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `خطأ ${r.status}`); }
        return r.json();
      })
      .then((d) => setTpls(Array.isArray(d?.templates) ? d.templates : []))
      .catch((e) => { setTpls([]); setTplErr((e as Error).message || "تعذّر جلب القوالب"); });
  }, [office]);
  useEffect(() => { loadTpls(); }, [loadTpls]);

  useEffect(() => {
    fetch("/api/towers").then((r) => (r.ok ? r.json() : [])).then((d) => setOffices(Array.isArray(d) ? d : [])).catch(() => {});
    loadTpls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    setLoading(true); setMsg("");
    const p = new URLSearchParams({ office, status, limit: "1000" });
    if (days) p.set("days", days);
    if (until) p.set("until", until);
    if (from && to) { p.set("from", from); p.set("to", to); }
    if (q.trim()) p.set("q", q.trim());
    fetch(`/api/subscribers/query?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) { setMsg("تعذّر جلب القائمة"); return; }
        setRows(d.rows ?? []); setTotal(d.total ?? 0); setChecked(new Set());
      })
      .catch(() => setMsg("تعذّر الاتصال"))
      .finally(() => setLoading(false));
  }, [office, status, days, until, from, to, q]);

  useEffect(() => { load(); }, [load]);

  const allOn = rows.length > 0 && checked.size === rows.length;
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: number) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function sendMessages() {
    if (!checked.size || !text.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "WHATSAPP", text, target: "list", subscriberIds: [...checked] }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok ? `✅ أُرسلت ${d.sent ?? 0} رسالة${d.failed ? ` — فشلت ${d.failed}` : ""}` : (d.error ?? "تعذّر الإرسال"));
      if (r.ok) { setSendOpen(false); setText(""); }
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  async function printReceipts() {
    if (!checked.size) return;
    if (!confirm(`طباعة ${checked.size} وصل مشترك على طابعة المكتب؟`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/print", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "notice", ids: [...checked] }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok
        ? `🖨️ أُرسلت ${d.queued ?? 0} وصل للطباعة${d.workerOnline ? "" : " — ⚠️ حاسبة المكتب غير متصلة الآن، ستُطبع عند تشغيلها"}`
        : (d.error ?? "تعذّرت الطباعة"));
    } catch { setBusy(false); setMsg("تعذّر الاتصال بالخادم"); }
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("subscribers.manage")) {
    return <div className="p-6"><PageHeader title="كلّ المشتركين" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية عرض المشتركين.</div></div>;
  }
  const isAdmin = !!me.isAdmin;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="كلّ المشتركين" subtitle="تحديدٌ جماعيّ · فلاتر الانتهاء والاتصال · إرسال رسائل · طباعة وصولات" />

      {/* الفلاتر */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {isAdmin && offices.length > 1 && (
          <L label="المكتب">
            <select value={office} onChange={(e) => setOffice(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="all">كل المكاتب</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `#${o.id}`}</option>)}
            </select>
          </L>
        )}
        <L label="الحالة">
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="all">الكل</option>
            <option value="active">الفعّالين</option>
            <option value="online">المتصلين الآن</option>
            <option value="expired">المنتهين</option>
          </select>
        </L>
        <L label="ينتهي خلال">
          <select value={days} onChange={(e) => { setDays(e.target.value); setUntil(""); setFrom(""); setTo(""); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">—</option>
            <option value="1">يوم واحد</option>
            <option value="2">يومين</option>
            <option value="3">٣ أيّام</option>
            <option value="7">٧ أيّام</option>
          </select>
        </L>
        <L label="ينتهي إلى تاريخ">
          <input type="date" value={until} onChange={(e) => { setUntil(e.target.value); setDays(""); setFrom(""); setTo(""); }} dir="ltr" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </L>
        <L label="منتهون بين تاريخين">
          <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDays(""); setUntil(""); }} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            <span className="text-slate-400">→</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDays(""); setUntil(""); }} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
        </L>
        <L label="بحث">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم / يوزر / هاتف / عنوان" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </L>
        <button onClick={() => { setStatus("all"); setDays(""); setUntil(""); setFrom(""); setTo(""); setQ(""); }}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">مسح الفلاتر</button>
      </div>

      {/* شريط الإجراءات */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <span className="text-sm font-bold text-slate-700">المجموع: {fmt(total)}</span>
        <span className="text-sm text-slate-500">· المحدَّد: <b className="text-mynet-blue">{checked.size}</b></span>
        <div className="flex-1" />
        <button onClick={() => { setSendOpen(true); setMsg(""); }} disabled={!checked.size || busy}
          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">📩 إرسال رسالة للمحدَّدين</button>
        <button onClick={printReceipts} disabled={!checked.size || busy}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">🖨️ طباعة وصولاتهم</button>
      </div>
      {msg && <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{msg}</div>}

      {/* الجدول */}
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2"><input type="checkbox" checked={allOn} onChange={toggleAll} title="تحديد الكل" className="h-4 w-4" /></th>
              <th className="p-2">المشترك</th><th className="p-2">اليوزر</th><th className="p-2">الهاتف</th>
              <th className="p-2">العنوان</th><th className="p-2">الباقة</th><th className="p-2">الانتهاء</th>
              <th className="p-2">الدين</th><th className="p-2">المكتب</th>
              {status === "online" && <th className="p-2">الاتصال</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="p-8 text-center text-slate-400">جاري التحميل…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="p-8 text-center text-slate-400">لا مشتركين مطابقين</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${checked.has(r.id) ? "bg-blue-50" : ""}`} onClick={() => toggle(r.id)} style={{ cursor: "pointer" }}>
                <td className="p-2"><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4" /></td>
                <td className="p-2 font-semibold text-slate-800">{r.name ?? "—"}</td>
                <td className="p-2 text-slate-500" dir="ltr">{r.netUser ?? "—"}</td>
                <td className="p-2 text-slate-500" dir="ltr">{r.phone ?? "—"}</td>
                <td className="p-2 text-slate-500">{r.address ?? "—"}</td>
                <td className="p-2 text-slate-500">{r.packageName ?? "—"}</td>
                <td className="p-2 text-slate-600" dir="ltr">{r.dateTo ? formatDate(r.dateTo) : "—"}</td>
                <td className={`p-2 font-bold ${r.carry > 0 ? "text-red-600" : "text-slate-400"}`}>{r.carry > 0 ? fmt(r.carry) : "—"}</td>
                <td className="p-2 text-slate-500">{r.office ?? "—"}</td>
                {status === "online" && <td className="p-2">{r.online ? <span className="text-emerald-600">🟢 متّصل</span> : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* نافذة إرسال الرسالة */}
      {sendOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setSendOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-center text-lg font-extrabold text-slate-800">📩 إرسال رسالة لـ {checked.size} مشترك</div>
            {tpls.length > 0 ? (
              <select onChange={(e) => { const t = tpls.find((x) => x.key === e.target.value); if (t?.text) setText(t.text); }}
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— اختر قالباً جاهزاً ({tpls.length}) —</option>
                {tpls.map((t) => (
                  <option key={t.key} value={t.key}>
                    {TPL_NAMES[t.type] ?? t.type}{SCOPE_TAG[t.scope] ?? ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {tplErr ? `تعذّر جلب القوالب: ${tplErr}` : "لا قوالب متاحة — أنشئها من صفحة «قوالب الرسائل»، أو اكتب النصّ يدويّاً أدناه."}
              </div>
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="نصّ الرسالة… يمكنك استعمال {اسم_المشترك} {اسم_المستخدم} {تاريخ_الانتهاء} {العنوان}"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <p className="mb-3 text-[11px] text-slate-400">تُرسَل عبر واتساب مكتب كلّ مشترك، بفاصل ١٠ ثوانٍ بين رسالة وأخرى.</p>
            <div className="flex gap-2">
              <button onClick={sendMessages} disabled={busy || !text.trim()} className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "جارٍ الإرسال…" : "إرسال"}</button>
              <button onClick={() => setSendOpen(false)} disabled={busy} className="rounded-lg bg-slate-100 px-4 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>{children}</label>);
}
