"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

  async function settle(t: Tech) {
    if (!confirm(`تحصيل ${fmt(t.pendingTotal)} د.ع من الفني ${t.name}؟ ستُزال تكتاته المنجزة.`)) return;
    setBusyId(t.id);
    const r = await fetch("/api/field/settlement", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technicianId: t.id }),
    });
    setBusyId(null);
    if (r.ok) load(); else alert("تعذّر التحصيل");
  }

  if (loading || techs.length === 0) return null;
  const officeName = (id: number | null) => offices.find((o) => o.id === id)?.name ?? "بدون مكتب";

  return (
    <div className="settle-strip" ref={stripRef}>
      <div className="ss-title">تحصيل الفنيين</div>
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
                    // قائمة منسدلة للأعلى فوق الزر (Portal — لا تمدد للبطاقة ولا قصّ)
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    // تثبيت بحافة الزر اليمنى والنمو يساراً — العرض يتبع طول النص تلقائياً
                    setPopPos({ top: r.top - 8, right: Math.max(8, window.innerWidth - r.right) });
                    setOpenId(t.id);
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
    </div>
  );
}
