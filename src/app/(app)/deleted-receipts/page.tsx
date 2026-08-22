"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

// ═════ 🗑️ سجلُّ الوصولات المحذوفة — المرحلةُ الأولى: عرضٌ وبحث (طلبُ محمد 2026-08-22) ═════
// «بدل هذا العناء كلّه لم لا نضع سجل الوصولات المحذوفة وفيه كل وصل حذف من كل مكان».
// وهذه المرحلةُ **قراءةٌ محضة**: لا زرَّ إرجاعٍ ولا كتابةً — الإرجاعُ مرحلةٌ ثانيةٌ بحُرّاسها.

type Kind = "activation" | "invoice" | "money" | "manager";

type Row = {
  key: string; kind: Kind; id: number;
  docDate: string | null; deletedAt: string | null; deletedExact: boolean;
  deletedBy: string | null; mode: "reverse" | "plain" | null;
  towerId: number | null; towerName: string | null;
  title: string; who: string | null; netUser: string | null;
  amount: number | null; received: number | null; dir: "in" | "out" | null; note: string | null;
};

type Data = {
  rows: Row[];
  counts: Record<Kind, number>;
  towers: { id: number; name: string | null }[];
  limit: number; capped: boolean; managerHidden: boolean;
};

const KINDS: { key: "" | Kind; label: string; icon: string }[] = [
  { key: "", label: "الكل", icon: "🗂️" },
  { key: "activation", label: "وصل تفعيل", icon: "📶" },
  { key: "invoice", label: "فاتورة مبيع", icon: "🧾" },
  { key: "money", label: "قيد صندوق", icon: "💵" },
  { key: "manager", label: "حركة مدير", icon: "🏦" },
];

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
/** يومُ بغداد بصيغة YYYY-MM-DD (الخادمُ قد يكون UTC، والمستخدمُ يقصد يومَه هو) */
const baghdadDay = (shiftDays = 0) =>
  new Date(Date.now() + 3 * 3600_000 - shiftDays * 86_400_000).toISOString().slice(0, 10);

export default function DeletedReceiptsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<"" | Kind>("");
  const [on, setOn] = useState<"del" | "doc">("del");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tower, setTower] = useState("");
  const [q, setQ] = useState("");        // النصُّ المُطبَّق فعلاً
  const [qBox, setQBox] = useState("");  // ما يكتبه المستخدم قبل الضغط

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (on === "doc") p.set("on", "doc");
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (tower) p.set("tower", tower);
    if (q) p.set("q", q);
    // مؤشّرُ الانتظار مؤجَّلٌ لا فوريّ: نداءُ setState داخل جسم الأثر يُشعل رسماً متتالياً
    // (قاعدةُ react-hooks/set-state-in-effect)، والتأجيلُ يمنع أيضاً وميضَه للطلب السريع.
    const spin = setTimeout(() => setBusy(true), 150);
    fetch(`/api/deleted-receipts?${p.toString()}`)
      .then((r) => {
        if (r.status === 403) { setDenied(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d: Data | null) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => { clearTimeout(spin); setBusy(false); });
  }, [kind, on, from, to, tower, q]);

  useEffect(() => { load(); }, [load]);

  if (denied) {
    return (
      <div className="p-6">
        <PageHeader title="🗑️ الوصولات المحذوفة" />
        <div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">
          هذه الصفحة تحتاج صلاحيّة «سجل الوصولات المحذوفة».
        </div>
      </div>
    );
  }

  const total = data ? data.counts.activation + data.counts.invoice + data.counts.money + data.counts.manager : 0;

  return (
    <div className="p-6">
      <PageHeader
        title="🗑️ الوصولات المحذوفة"
        subtitle="كلُّ وصلٍ مُسِح في وكالتك — تفعيلاً كان أو فاتورةً أو قيدَ صندوقٍ أو حركةَ مدير"
      />

      {/* أنواعُ الوثائق بعدّاداتها */}
      <div className="mb-3 flex flex-wrap gap-2">
        {KINDS.map((k) => {
          const n = k.key === "" ? total : data?.counts[k.key] ?? 0;
          const active = kind === k.key;
          return (
            <button
              key={k.key || "all"}
              onClick={() => setKind(k.key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${active ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              {k.icon} {k.label} <span className={active ? "text-slate-300" : "text-slate-400"}>({n})</span>
            </button>
          );
        })}
      </div>

      {/* البحث: بين تاريخين · كلمة · مكتب */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-xs font-semibold text-slate-500">
          المدى على
          <select
            value={on}
            onChange={(e) => setOn(e.target.value === "doc" ? "doc" : "del")}
            className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="del">وقت الحذف</option>
            <option value="doc">تاريخ الوصل</option>
          </select>
        </label>

        <label className="text-xs font-semibold text-slate-500">
          من
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700" dir="ltr" />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          إلى
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700" dir="ltr" />
        </label>

        <div className="flex gap-1">
          {([["اليوم", 0], ["أمس", 1], ["٧ أيام", 6]] as const).map(([label, d]) => (
            <button key={label}
              onClick={() => { setFrom(baghdadDay(d)); setTo(baghdadDay(0)); }}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">
              {label}
            </button>
          ))}
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200">
              ✕ المدى
            </button>
          )}
        </div>

        <label className="text-xs font-semibold text-slate-500">
          المكتب
          <select value={tower} onChange={(e) => setTower(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700">
            <option value="">كلّ المكاتب</option>
            {(data?.towers ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>
            ))}
          </select>
        </label>

        <label className="flex-1 text-xs font-semibold text-slate-500" style={{ minWidth: 220 }}>
          بحث
          <span className="mt-1 flex gap-1">
            <input
              value={qBox}
              onChange={(e) => setQBox(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setQ(qBox.trim()); }}
              placeholder="اسم مشترك · يوزر · رقم وصل · سيريال · ملاحظة"
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
            />
            <button onClick={() => setQ(qBox.trim())}
              className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
              بحث
            </button>
            {q && (
              <button onClick={() => { setQBox(""); setQ(""); }}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-200">
                ✕
              </button>
            )}
          </span>
        </label>
      </div>

      {data?.managerHidden && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">
          ℹ️ حركاتُ المدير على مستوى الوكيل ولا تحمل مكتباً — فهي مخفيّةٌ ما دام مكتبٌ بعينه مُختاراً.
        </div>
      )}
      {data?.capped && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">
          ⚠️ العرضُ مقصورٌ على {data.limit} صفّاً لكلّ نوع — ضيّق المدى أو ابحث بكلمةٍ لترى الباقي.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3">النوع</th>
              <th className="p-3">الجهة</th>
              <th className="p-3">المبلغ</th>
              <th className="p-3">الواصل</th>
              <th className="p-3">المكتب</th>
              <th className="p-3">تاريخ الوصل</th>
              <th className="p-3">مَن حذف</th>
              <th className="p-3">وقت الحذف</th>
              <th className="p-3">كيف</th>
              <th className="p-3">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-400">
                  {busy ? "…" : "لا وصولاتٍ محذوفةً ضمن هذا البحث"}
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100 align-top">
                  <td className="p-3 whitespace-nowrap font-semibold text-slate-700">
                    {r.title}
                    <span className="mr-1 text-xs font-normal text-slate-400">#{r.id}</span>
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-slate-700">{r.who ?? "—"}</div>
                    {r.netUser && <div className="text-xs text-slate-400" dir="ltr">{r.netUser}</div>}
                  </td>
                  <td className={`p-3 font-bold ${r.dir === "out" ? "text-rose-700" : "text-slate-800"}`}>
                    {r.dir === "out" ? "−" : ""}{fmt(r.amount)}
                  </td>
                  <td className="p-3 text-slate-600">{fmt(r.received)}</td>
                  <td className="p-3 whitespace-nowrap text-slate-600">{r.towerName ?? (r.kind === "manager" ? "الوكيل" : "—")}</td>
                  <td className="p-3 whitespace-nowrap text-slate-500" dir="ltr">{r.docDate ? formatDateTime(r.docDate) : "—"}</td>
                  <td className="p-3 whitespace-nowrap text-slate-600">{r.deletedBy ?? "—"}</td>
                  <td className="p-3 whitespace-nowrap text-slate-500" dir="ltr">
                    {r.deletedAt ? formatDateTime(r.deletedAt) : "—"}
                    {!r.deletedExact && <span className="mr-1 text-xs text-amber-600" title="لا سطرَ تدقيقٍ لهذا الحذف — الوقتُ من آخر تعديلٍ على الصفّ">~</span>}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {r.mode === "reverse" ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">بأثرٍ ماليّ</span>
                    ) : r.mode === "plain" ? (
                      <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">بلا أثرٍ ماليّ</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-slate-500">{r.note ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        «بلا أثرٍ ماليّ» تعني أنّ الوصلَ أُخفي وبقي مبلغُه في الصندوق — راجعها في حارس المال.
        و«~» تعني أنّ وقتَ الحذف تقريبيٌّ لغياب سطر تدقيقٍ لتلك العمليّة.
      </p>
    </div>
  );
}
