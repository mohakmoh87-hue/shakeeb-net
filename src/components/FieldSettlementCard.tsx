"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { announceMoneyChanged } from "@/lib/moneyRefresh";
import { usePermission } from "@/lib/usePermission";

// قيد التحصيل: كل ضغطة «اكمال» صارت سطراً دائماً يُعرض ويمكن سحبه — وكان يمحو
// المبلغ بلا أثر، والبطاقات تُحذف بعد أسبوع فيضيع أصل الرقم (المرحلة ٨).
type SettleRow = {
  id: number; date: string; technicianId: number; technician: string; by: string | null;
  count: number; total: number; sale: number; sub: number; undone: boolean;
};

type Item = { title: string; kind: string; amount: number; subAmount?: number; netUser?: string | null };
type Tech = { id: number; name: string; towerId: number | null; pendingTotal: number; saleTotal?: number; subTotal?: number; pendingCount: number; items?: Item[] };
type Office = { id: number; name: string | null };

const fmt = (n: number) => Number(n).toLocaleString("en-US");
const KIND_ICON: Record<string, string> = { "توصيل": "🚚", "صيانة": "🔧", "تنصيب": "🔧", "اعادة": "🔁", "تحويل": "↪️" };

// تحصيل الفنيين — شريط أفقي أسفل جدول المشتركين (بنية النموذج المعتمد):
// لكل فني بطاقة: الاسم، المكتب، المجموع، زرّ «+» يفتح تفاصيل المبلغ، وزرّ «اكمال».
export default function FieldSettlementCard() {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null); // فني مفتوح تفصيل مبلغه
  const [popPos, setPopPos] = useState<{ top: number; right: number } | null>(null); // موضع القائمة العائمة (تنمو يساراً)
  const stripRef = useRef<HTMLDivElement>(null);
  const { can } = usePermission();
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<SettleRow[] | null>(null);
  // النقر في أي مكان خارج القائمة العائمة يغلقها تلقائياً (طلب محمد)
  useEffect(() => {
    if (openId == null) return;
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest || (!t.closest(".ss-pop") && !t.closest(".ss-plus"))) setOpenId(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [openId]);

  const load = useCallback(() => {
    fetch("/api/field/settlement")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setTechs(d.technicians ?? []); setOffices(d.offices ?? []); } })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  function openLog() {
    setLogOpen(true); setLog(null);
    fetch("/api/field/settlement/log").then((r) => (r.ok ? r.json() : null)).then((d) => setLog(d?.rows ?? [])).catch(() => setLog([]));
  }

  async function undoSettle(row: SettleRow) {
    if (!confirm(`سحب تحصيل ${fmt(row.total)} د.ع من ${row.technician}؟\nستعود ${row.count} بطاقة غير محصّلة وتظهر في تحصيله من جديد.`)) return;
    const r = await fetch("/api/field/settlement/log", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      alert(d.missing > 0
        ? `رجعت ${d.restored} بطاقة — و${d.missing} حُذفت نهائياً فلم تعد`
        : `رجعت ${d.restored} بطاقة`);
      openLog(); load(); announceMoneyChanged();
    } else alert(d.error ?? "تعذّر السحب");
  }

  async function settle(t: Tech) {
    if (!confirm(`تحصيل ${fmt(t.pendingTotal)} د.ع من الفني ${t.name}؟ ستُزال تكتاته المنجزة.`)) return;
    setBusyId(t.id);
    const r = await fetch("/api/field/settlement", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technicianId: t.id }),
    });
    setBusyId(null);
    if (r.ok) { announceMoneyChanged(); load(); } else alert("تعذّر التحصيل");
  }

  if (loading || techs.length === 0) return null;
  const officeName = (id: number | null) => offices.find((o) => o.id === id)?.name ?? "بدون مكتب";

  return (
    <div className="settle-strip" ref={stripRef}>
      <div className="ss-title">
        تحصيل الفنيين
        <button onClick={openLog} title="سجل التحصيلات السابقة"
          style={{ marginInlineStart: 10, fontSize: 11, fontWeight: 700, background: "transparent", border: "1px solid var(--line, #d5dbe0)", borderRadius: 8, padding: "2px 8px", cursor: "pointer", color: "inherit" }}>
          🧾 السجل
        </button>
      </div>
      <div className="ss-row">
        {techs.map((t) => {
          const open = openId === t.id;
          return (
            <div key={t.id} className="ss-item">
              <div className="ss-nm">{t.name}</div>
              <div className="ss-of">{officeName(t.towerId)}</div>
              <div className="ss-amt">{fmt(t.pendingTotal)} <small>د.ع</small></div>
              <div className="ss-acts">
                <button
                  className={`ss-plus ${open ? "on" : ""}`}
                  title="تفاصيل المبلغ"
                  disabled={t.pendingCount <= 0}
                  onClick={(e) => {
                    if (open) { setOpenId(null); return; }
                    const btn = e.currentTarget as HTMLElement;
                    // الهاتف: مرّر بطاقة الفني لأقصى اليمين أولاً — القائمة تنمو يساراً
                    // فتظهر كاملة بدل خروجها عن الشاشة (طلب محمد — الهاتف فقط)
                    if (window.innerWidth <= 767) {
                      btn.closest(".ss-item")?.scrollIntoView({ inline: "start", block: "nearest" });
                    }
                    // القياس بعد استقرار التمرير: تثبيت بحافة الزر اليمنى والنمو يساراً
                    requestAnimationFrame(() => {
                      const r = btn.getBoundingClientRect();
                      setPopPos({ top: r.top - 8, right: Math.max(8, window.innerWidth - r.right) });
                      setOpenId(t.id);
                    });
                  }}
                >
                  {open ? "−" : "+"}
                </button>
                <button className="ss-btn" disabled={t.pendingCount <= 0 || busyId === t.id} onClick={() => settle(t)}>
                  {busyId === t.id ? "…" : "اكمال"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* قائمة التفاصيل المنسدلة للأعلى من زر «+» (طلب محمد) */}
      {openId != null && popPos && typeof document !== "undefined" && (() => {
        const t = techs.find((x) => x.id === openId);
        if (!t) return null;
        return createPortal(
          <div className="nst">
            <div className="ss-pop" onClick={(e) => e.stopPropagation()}
              style={{ position: "fixed", top: popPos.top, right: popPos.right, left: "auto", transform: "translateY(-100%)", width: "fit-content", minWidth: 280, maxWidth: "min(92vw, 620px)", maxHeight: "60vh", overflowY: "auto", zIndex: 95 }}>
              <div className="ss-pop-h">{t.name} — تفاصيل المبلغ</div>
              {(t.items ?? []).length === 0 ? (
                <div className="sd-empty">لا تفاصيل</div>
              ) : (
                <div className="ss-det" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  {(t.items ?? []).map((it, idx) => (
                    <div key={idx} className="sd-row">
                      <span>
                        {KIND_ICON[it.kind] ?? "🔧"} {it.kind} — {it.title}
                        {it.netUser && <i dir="ltr"> {it.netUser}</i>}
                      </span>
                      <b>
                        {it.amount > 0 && fmt(it.amount)}
                        {(it.subAmount ?? 0) > 0 && <em>{it.amount > 0 ? " + " : ""}اشتراك {fmt(it.subAmount ?? 0)}</em>}
                        {it.amount <= 0 && (it.subAmount ?? 0) <= 0 && "0"}
                      </b>
                    </div>
                  ))}
                  <div className="sd-tot">
                    <span>المجموع الكلي (مبيع {fmt(t.saleTotal ?? 0)} + اشتراك {fmt(t.subTotal ?? 0)})</span>
                    <b>{fmt(t.pendingTotal)} د.ع</b>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        );
      })()}

      {logOpen && createPortal(
        <div onClick={() => setLogOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", color: "#0f172a", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", fontWeight: 800 }}>
              🧾 سجل تحصيل الفنيين
              <div style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>
                التحصيل نقلُ مالٍ من يد الفني إلى المكتب — لا إيراد جديد (مال المبيع سُجّل فاتورةً لحظة إنجاز البطاقة).
              </div>
            </div>
            {log == null ? (
              <div style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}>جاري التحميل...</div>
            ) : log.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}>لا تحصيلات مسجّلة بعد</div>
            ) : (
              <table style={{ width: "100%", fontSize: 12, textAlign: "right", borderCollapse: "collapse" }}>
                <thead style={{ background: "#f8fafc", color: "#475569" }}>
                  <tr><th style={{ padding: 8 }}>التاريخ</th><th style={{ padding: 8 }}>الفني</th><th style={{ padding: 8 }}>البطاقات</th>
                    <th style={{ padding: 8 }}>مبيع</th><th style={{ padding: 8 }}>اشتراك</th><th style={{ padding: 8 }}>المجموع</th>
                    <th style={{ padding: 8 }}>بواسطة</th>{can("receipts.void") && <th style={{ padding: 8 }} />}</tr>
                </thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9", opacity: r.undone ? .5 : 1 }}>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }} dir="ltr">{new Date(r.date).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td style={{ padding: 8, fontWeight: 700 }}>{r.technician}</td>
                      <td style={{ padding: 8 }}>{r.count}</td>
                      <td style={{ padding: 8 }}>{fmt(r.sale)}</td>
                      <td style={{ padding: 8 }}>{fmt(r.sub)}</td>
                      <td style={{ padding: 8, fontWeight: 800 }}>{fmt(r.total)}</td>
                      <td style={{ padding: 8, color: "#64748b" }}>{r.by ?? "—"}</td>
                      {can("receipts.void") && (
                        <td style={{ padding: 8 }}>
                          {r.undone ? (
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>مسحوب</span>
                          ) : (
                            <button onClick={() => undoSettle(r)} style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", background: "#fef2f2", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>سحب</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
