"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { formatDate } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";

type Subscriber = {
  id: number;
  name: string | null;
  phone: string | null;
  carry: number | null;
  dateTo: string | null;
  packageId: number | null;
};
type Pkg = { id: number; name: string | null; priceDinar: number | null };
type Entry = {
  id: number;
  subscriberName: string | null;
  date: string | null;
  dateTo: string | null;
  money: number | null;
  moneyIn: number | null;
  moneyCarry: number | null;
  month: string | null;
  cardType: string | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");
const fmtDate = (d: string | null) => formatDate(d);

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">جاري التحميل...</div>}>
      <SubscriptionsInner />
    </Suspense>
  );
}

function SubscriptionsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = usePermission();
  const preselectId = searchParams.get("subscriberId");
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);

  const [subQuery, setSubQuery] = useState("");
  const [subId, setSubId] = useState<number | "">("");
  const [packageId, setPackageId] = useState<number | "">("");
  const [months, setMonths] = useState(1);
  const [paid, setPaid] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/packages").then((r) => void (r.ok && r.json().then(setPackages)));
    loadEntries();
  }, []);

  // تحديد المشترك مسبقاً عند القدوم من صفحة المشتركين
  useEffect(() => {
    if (!preselectId) return;
    fetch(`/api/subscribers/${preselectId}`).then((r) => {
      if (!r.ok) return;
      r.json().then((s: Subscriber) => {
        setSubs([s]);
        setSubId(s.id);
        setSubQuery(s.name ?? "");
        if (s.packageId) setPackageId(s.packageId);
      });
    });
  }, [preselectId]);

  function loadEntries() {
    fetch("/api/subscriptions").then((r) => void (r.ok && r.json().then(setEntries)));
  }

  // حذف وصل تفعيل عكسياً (إرجاع الأيام والمبلغ والكارت)
  async function voidEntry(id: number) {
    if (!window.confirm("حذف وصل التفعيل عكسياً؟\nسيرجع المشترك لحالته قبل هذا الوصل (تُلغى الأيام والمبلغ ويُرجَع الكارت للمخزون).")) return;
    const res = await fetch(`/api/subscription-entries/${id}/void`, { method: "POST" });
    if (res.ok) loadEntries();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "تعذّر الحذف");
    }
  }

  // بحث المشتركين
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/subscribers?q=${encodeURIComponent(subQuery)}`).then(
        (r) => void (r.ok && r.json().then(setSubs)),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [subQuery]);

  const selectedSub = subs.find((s) => s.id === subId);
  const selectedPkg = packages.find((p) => p.id === packageId);

  // الحساب الحيّ
  const calc = useMemo(() => {
    const price = selectedPkg?.priceDinar ?? 0;
    const prevCarry = selectedSub?.carry ?? 0;
    const total = price * months;
    const totalDue = total + prevCarry;
    const paidNum = Number(paid) || 0;
    const newCarry = totalDue - paidNum;
    const now = new Date();
    const currentTo = selectedSub?.dateTo ? new Date(selectedSub.dateTo) : null;
    const start = currentTo && currentTo > now ? currentTo : now;
    const dateTo = addMonths(start, months);
    return { price, prevCarry, total, totalDue, paidNum, newCarry, dateTo };
  }, [selectedPkg, selectedSub, months, paid]);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!subId || !packageId) {
      setError("اختر المشترك والباقة");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriberId: subId,
          packageId,
          months,
          paid: Number(paid) || 0,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل التفعيل");
        return;
      }
      // إعادة تعيين وفتح الوصل
      loadEntries();
      setPaid("");
      setNotes("");
      router.push(`/subscriptions/${data.id}/receipt`);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="التفعيل والتجديد"
        subtitle="تفعيل أو تجديد اشتراك وإصدار الوصل"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* نموذج التفعيل */}
        <form
          onSubmit={activate}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* اختيار المشترك */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                المشترك <span className="text-red-500">*</span>
              </label>
              <input
                value={subQuery}
                onChange={(e) => {
                  setSubQuery(e.target.value);
                  setSubId("");
                }}
                placeholder="ابحث بالاسم أو الهاتف..."
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
              <select
                value={subId}
                onChange={(e) => setSubId(Number(e.target.value) || "")}
                size={5}
                className="w-full rounded-lg border border-slate-300 p-1 outline-none focus:border-mynet-blue"
              >
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.phone ? `— ${s.phone}` : ""}{" "}
                    {s.carry ? `(دين: ${fmt(s.carry)})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                الباقة <span className="text-red-500">*</span>
              </label>
              <select
                value={packageId}
                onChange={(e) => setPackageId(Number(e.target.value) || "")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              >
                <option value="">— اختر —</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({fmt(p.priceDinar)} د.ع)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                عدد الأشهر
              </label>
              <input
                type="number"
                min={1}
                value={months}
                onChange={(e) => setMonths(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                المبلغ المدفوع (الواصل)
              </label>
              <input
                type="number"
                min={0}
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                ملاحظات
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-5 w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white shadow transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "جاري التفعيل..." : "تفعيل وإصدار الوصل 🧾"}
          </button>
        </form>

        {/* ملخّص الحساب الحيّ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 border-b border-slate-100 pb-2 text-lg font-bold text-slate-800">
            ملخّص العملية
          </h3>
          <dl className="space-y-3 text-sm">
            <Row label="سعر الباقة (شهر)" value={`${fmt(calc.price)} د.ع`} />
            <Row label="عدد الأشهر" value={String(months)} />
            <Row label="قيمة الاشتراك" value={`${fmt(calc.total)} د.ع`} />
            <Row
              label="الدين السابق"
              value={`${fmt(calc.prevCarry)} د.ع`}
              danger={calc.prevCarry > 0}
            />
            <div className="border-t border-dashed border-slate-200" />
            <Row
              label="المطلوب الكلي"
              value={`${fmt(calc.totalDue)} د.ع`}
              bold
            />
            <Row label="المدفوع" value={`${fmt(calc.paidNum)} د.ع`} />
            <Row
              label="الدين الجديد"
              value={`${fmt(calc.newCarry)} د.ع`}
              danger={calc.newCarry > 0}
              bold
            />
            <div className="border-t border-dashed border-slate-200" />
            <Row
              label="ينتهي الاشتراك في"
              value={formatDate(calc.dateTo)}
              highlight
            />
          </dl>
        </div>
      </div>

      {/* آخر العمليات */}
      <div className="mt-8">
        <h3 className="mb-3 text-lg font-bold text-slate-800">آخر العمليات</h3>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">المشترك</th>
                <th className="p-3">الباقة</th>
                <th className="p-3">أشهر</th>
                <th className="p-3">القيمة</th>
                <th className="p-3">المدفوع</th>
                <th className="p-3">الدين</th>
                <th className="p-3">ينتهي</th>
                <th className="p-3">الوصل</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400">
                    لا توجد عمليات بعد
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="p-3">{e.id}</td>
                    <td className="p-3 font-medium">{e.subscriberName ?? "—"}</td>
                    <td className="p-3">{e.cardType ?? "—"}</td>
                    <td className="p-3">{e.month ?? "—"}</td>
                    <td className="p-3">{fmt(e.money)}</td>
                    <td className="p-3 text-emerald-600">{fmt(e.moneyIn)}</td>
                    <td className="p-3 text-red-600">{fmt(e.moneyCarry)}</td>
                    <td className="p-3">{fmtDate(e.dateTo)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <a
                          href={`/subscriptions/${e.id}/receipt`}
                          className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
                        >
                          🖨️ طباعة
                        </a>
                        {can("receipts.void") && (
                          <button
                            onClick={() => voidEntry(e.id)}
                            className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                            title="حذف عكسي (إرجاع الأيام والمبلغ والكارت)"
                          >
                            🗑 حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  danger,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  danger?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`${bold ? "font-bold" : ""} ${
          danger ? "text-red-600" : highlight ? "text-mynet-blue" : "text-slate-800"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
