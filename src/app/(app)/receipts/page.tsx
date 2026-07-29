"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { usePermission } from "@/lib/usePermission";
import { askVoidEffect } from "@/lib/voidPrompt";

// سجل الوصولات العام (ب3 — صفحة النموذج المعتمد): قائمة منسدلة تبدّل بين
// وصولات المشتركين (التفعيلات) ووصولات المبيعات (الفواتير)، بحث، فرز بالأعمدة،
// إعادة طباعة وحذف (عكسي) للمحدّدين، ومجموع أسفلها.
type SubRow = {
  id: number; date: string | null; money: number | null; moneyIn: number | null;
  cardType: string | null; createdByUser: string | null; subscriberName: string | null;
};
type InvRow = {
  id: number; number: number | null; date: string | null; totalMy: number | null;
  waselHim: number | null; type: string | null; user: string | null; subscriberName: string | null; note: string | null;
};
type Row = { id: number; ref: number; date: string | null; who: string; cat: string; amount: number; by: string };

const fmt = (n: number) => Number(n).toLocaleString("en-US");

export default function ReceiptsPage() {
  const router = useRouter();
  const { can } = usePermission();
  const [kind, setKind] = useState<"sub" | "inv">("sub");
  const [subRows, setSubRows] = useState<SubRow[]>([]);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: "ref" | "date" | "who" | "amount"; dir: 1 | -1 }>({ key: "ref", dir: -1 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/subscriptions").then((r) => (r.ok ? r.json() : [])).then(setSubRows).catch(() => {});
    fetch("/api/invoices").then((r) => (r.ok ? r.json() : [])).then(setInvRows).catch(() => {});
  }, []);

  // توحيد الصفوف للجدول (المصدر حسب النوع المختار)
  const rows: Row[] = useMemo(() => {
    const list: Row[] =
      kind === "sub"
        ? subRows.map((e) => ({
            id: e.id, ref: e.id, date: e.date, who: e.subscriberName ?? "—",
            cat: e.cardType ?? "تفعيل", amount: e.moneyIn ?? 0, by: e.createdByUser ?? "—",
          }))
        : invRows.map((v) => ({
            id: v.id, ref: v.number ?? v.id, date: v.date, who: v.subscriberName ?? (v.note?.match(/الزبون:\s*([^—]+)/)?.[1]?.trim() ?? "—"),
            cat: v.type ?? "بيع", amount: v.waselHim ?? 0, by: v.user ?? "—",
          }));
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? list.filter((r) =>
          String(r.ref).includes(needle) || r.who.toLowerCase().includes(needle) ||
          String(r.amount).includes(needle.replace(/,/g, "")) || r.cat.toLowerCase().includes(needle))
      : list;
    const dir = sort.dir;
    return [...filtered].sort((a, b) => {
      if (sort.key === "ref") return (a.ref - b.ref) * dir;
      if (sort.key === "amount") return (a.amount - b.amount) * dir;
      if (sort.key === "who") return a.who.localeCompare(b.who, "ar") * dir;
      return ((a.date ?? "") < (b.date ?? "") ? -1 : 1) * dir;
    });
  }, [kind, subRows, invRows, q, sort]);

  const sum = rows.reduce((s, r) => s + r.amount, 0);

  function toggleSort(key: "ref" | "date" | "who" | "amount") {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  }
  function toggle(id: number) {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));

  // إعادة طباعة صامتة للمحدّدين (تلتقطها حاسبة مكتب المشترك)
  async function reprint() {
    if (checked.size === 0 || busy) return;
    setBusy(true); setMsg("");
    let ok = 0;
    for (const id of checked) {
      const r = await fetch("/api/print", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kind === "sub" ? "subscription" : "invoice", id }),
      }).catch(() => null);
      if (r?.ok) ok++;
    }
    setBusy(false);
    setMsg(`🖨️ أُرسل ${ok} وصلاً للطباعة`);
  }

  // حذف عكسي للمحدّدين (سؤال واحد يسري على الجميع)
  async function removeChecked() {
    if (checked.size === 0 || busy) return;
    const choice = await askVoidEffect(`${checked.size} وصلاً محدّداً`);
    if (!choice) return;
    setBusy(true); setMsg("");
    let ok = 0;
    for (const id of checked) {
      const r = await fetch(
        kind === "sub" ? `/api/subscription-entries/${id}/void` : `/api/invoices/${id}/void`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reverse: choice.reverse }) },
      ).catch(() => null);
      if (r?.ok) ok++;
    }
    setBusy(false); setChecked(new Set());
    setMsg(`🗑️ حُذف ${ok} وصلاً`);
    // إعادة الجلب
    fetch("/api/subscriptions").then((r) => (r.ok ? r.json() : [])).then(setSubRows).catch(() => {});
    fetch("/api/invoices").then((r) => (r.ok ? r.json() : [])).then(setInvRows).catch(() => {});
  }

  const arrow = (key: string) => (sort.key === key ? (sort.dir === -1 ? "↓" : "↑") : "↕");

  return (
    <div className="nst min-h-screen bg-ground p-4 md:p-[20px_22px_34px]">
      <div className="pg-h">
        <button className="back" onClick={() => router.push("/dashboard")}>→ رجوع</button>
        <h1>سجل الوصولات</h1>
      </div>
      <div className="card">
        <div className="ch">
          <select className="pgsel" value={kind} onChange={(e) => { setKind(e.target.value as "sub" | "inv"); setChecked(new Set()); setMsg(""); }}>
            <option value="sub">📄 وصولات المشتركين (التفعيلات)</option>
            <option value="inv">🛒 وصولات المبيعات (الفواتير)</option>
          </select>
          <div className="hbtns">
            <button className="gbtn" onClick={() => void reprint()} disabled={checked.size === 0 || busy}>🖨️ إعادة طباعة</button>
            {can("receipts.void") && (
              <button className="gbtn danger" onClick={() => void removeChecked()} disabled={checked.size === 0 || busy}>🗑️ حذف</button>
            )}
          </div>
        </div>
        <div className="searchbar">
          <span className="sicon">🔍</span>
          <input className="sq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث برقم الوصل أو اسم المشترك أو المبلغ" />
        </div>
        {msg && <div style={{ margin: "0 16px 8px" }} className="rounded-lg bg-ok/10 px-3 py-1.5 text-center text-xs font-semibold text-ok">{msg}</div>}
        <div className="tscroll" style={{ maxHeight: "62vh", overflowY: "auto" }}>
          <table className="tbl">
            <thead><tr>
              <th className="cbcol"><input type="checkbox" className="cb" checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th className="srt" onClick={() => toggleSort("ref")}>رقم الوصل <i>{arrow("ref")}</i></th>
              <th className="srt" onClick={() => toggleSort("date")}>التاريخ <i>{arrow("date")}</i></th>
              <th className="srt" onClick={() => toggleSort("who")}>المشترك <i>{arrow("who")}</i></th>
              <th>الفئة</th>
              <th className="srt" onClick={() => toggleSort("amount")}>المبلغ <i>{arrow("amount")}</i></th>
              <th>المستخدم</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>لا وصولات</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className={checked.has(r.id) ? "picked" : ""}>
                  <td className="cbcol"><input type="checkbox" className="cb" checked={checked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="ref num">{r.ref}</td>
                  <td className="num" dir="ltr">{formatDateTime(r.date)}</td>
                  <td>{r.who}</td>
                  <td>{r.cat}</td>
                  <td className="num">{fmt(r.amount)}</td>
                  <td>{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pg-f">
          <span>{rows.length} وصلاً{checked.size > 0 ? ` — محدّد ${checked.size}` : ""}</span>
          <span className="pg-tot">المجموع: <b>{fmt(sum)}</b> د.ع</span>
        </div>
      </div>
    </div>
  );
}
