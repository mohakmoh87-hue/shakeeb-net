"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ChampionEmoji from "@/components/ChampionEmoji";
import WaStatusBadge from "@/components/WaStatusBadge";
import { hasTrialSkin } from "@/components/trialSkin";

// ═════════ 🧪 مربّعُ «إدارة الفنيّين» في رئيسيّة النموذج (شاشة أ) ═════════
//
// من نموذج «واجهات تطبيق شكيب» المعتمَد: العمودُ الأيسرُ في رئيسيّة التطبيق —
// شريطُ عدَدَي المشتركين ← حلقةُ الإنجاز مع الوسائل (منجزة/متبقّية/تذاكر أودو)
// ← شريطُ المتصدّر ← زرُّ «سجلّ الوصولات» العريض.
//
// 🛡️ لا يعمل إلّا تحت علَم التجربة: بلا الكعكة يرجع null قبل أيّ جلبٍ — فصفرُ
//    كلفةٍ وصفرُ أثرٍ على الإنتاج. والبياناتُ من مساراتٍ قائمةٍ معزولةٍ بالجلسة
//    أصلاً (board/achievements/stats) — لا مسارَ جديدَ ولا عزلَ جديد.
export type TrialFmDemo = {
  done: number; left: number; odoo: number;
  leader: { name: string; points: number } | null;
  // تصحيح محمد 2026-08-19: الرقمان هما الفعّالون والمتّصلون — لا الكلّيّ
  subs: { active: number; online: number | null } | null;
};

// demo: صفحةُ المعاينة /trial/preview تمرّر أرقاماً جاهزةً فتُرسم البطاقةُ بلا جلبٍ ولا علَم
export default function TrialFmCard({ demo }: { demo?: TrialFmDemo }) {
  const [on, setOn] = useState(!!demo);
  const [done, setDone] = useState(demo?.done ?? 0);
  const [left, setLeft] = useState(demo?.left ?? 0);
  const [odoo, setOdoo] = useState(demo?.odoo ?? 0);
  const [leader, setLeader] = useState<{ name: string; points: number } | null>(demo?.leader ?? null);
  const [subs, setSubs] = useState<{ active: number; online: number | null } | null>(demo?.subs ?? null);

  useEffect(() => {
    if (demo) return; // المعاينةُ ببياناتها — لا جلب
    if (!hasTrialSkin()) return; // الإنتاجُ يقف هنا — لا جلبَ ولا رسم
    // الإظهارُ داخل ردّ الجلب لا في جسم التأثير (قاعدة set-state-in-effect) —
    // والبطاقةُ بلا بياناتها لا معنى لها أصلاً فلا خسارةَ في الانتظار
    fetch("/api/field/board")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setOn(true);
        if (!d?.cards) return;
        const cards = d.cards as { done?: boolean }[];
        setDone(cards.filter((c) => c.done).length);
        setLeft(cards.filter((c) => !c.done).length);
        setOdoo(Number(d.odooOpen ?? 0));
      })
      .catch(() => setOn(true));
    fetch("/api/field/achievements?leader=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.leader?.name) setLeader({ name: d.leader.name, points: Number(d.leader.points ?? 0) }); })
      .catch(() => {});
    fetch("/api/subscribers/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.offices) return;
        // تصحيح محمد: الفعّالون والمتّصلون (لا الكلّيّ) — والمتّصلون قد يغيبون عن الرفعة
        // السحابيّة لبعض المكاتب فيُجمَع الموجودُ منهم ويُعرَض «—» إن غاب الكلُّ
        let active = 0, online = 0, onlineKnown = false;
        for (const o of Object.values(d.offices as Record<string, { active?: number; online?: number | null }>)) {
          active += Number(o?.active ?? 0);
          if (o?.online != null) { online += Number(o.online); onlineKnown = true; }
        }
        setSubs({ active, online: onlineKnown ? online : null });
      })
      .catch(() => {});
  }, [demo]);

  if (!on) return null;

  const all = done + left;
  const pct = all > 0 ? Math.round((done / all) * 100) : 0;
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div data-trial-fm className="tfm">
      {/* مؤشّرُ الواتساب فوق كلّ شيء — أعلى الرقمَين (طلب محمد 2026-08-19) */}
      <div className="tfm-wa"><WaStatusBadge /></div>
      {subs && (
        <Link href="/all-subscribers" className="tfm-subs" title="الفعّالون والمتّصلون — اضغط لفتح قائمة المشتركين">
          <span title="المشتركون الفعّالون"><i className="tfm-dot" style={{ background: "#86efac" }} />{fmt(subs.active)}</span>
          <span title="المتّصلون الآن"><i className="tfm-dot" style={{ background: "#a5e3ff" }} />{subs.online == null ? "—" : fmt(subs.online)}</span>
        </Link>
      )}
      <Link href="/field-management" className="tfm-main" title="اضغط لفتح إدارة الفنيّين">
        <h4>إدارة الفنيّين</h4>
        <div className="tfm-row">
          <div className="tfm-ring" style={{ background: `conic-gradient(#0a4f8a 0 ${pct}%, #d7e8f7 ${pct}% 100%)` }}>
            <i>{pct}٪</i>
          </div>
          <div className="tfm-legend">
            <div><span>منجزة</span><b>{fmt(done)}</b></div>
            <div><span>متبقّية</span><b>{fmt(left)}</b></div>
            <div><span>تذاكر أودو</span><b>{fmt(odoo)}</b></div>
          </div>
        </div>
        {leader && (
          <div className="tfm-badge">
            <ChampionEmoji size={30} />
            <span className="tfm-nm">{leader.name}</span>
            <span className="tfm-pill">{leader.points.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
          </div>
        )}
      </Link>
      <Link href="/receipts" className="tfm-receipts" title="اضغط لفتح سجلّ الوصولات">سجلّ الوصولات</Link>
    </div>
  );
}
