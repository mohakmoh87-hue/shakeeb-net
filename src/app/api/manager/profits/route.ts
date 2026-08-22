import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { computeProfits, getPeriod, startNewMonth, monthRange, monthLabel, rangeWarning, baghdadParts, getSavedView, saveView } from "@/lib/profits";

export const dynamic = "force-dynamic";

// ═════ 📈 أرباحُ الشركة — قراءةٌ وحساب (طلبُ محمد 2026-08-22) ═════
// 🔒 بصلاحيّة حسابات المدير نفسِها (`manager.accounts`) وبعزل الوكيل ومكاتبه.
// ✋ ولا يكتب هذا المسارُ أيَّ قيدٍ ماليّ: يحسب من بياناتٍ قائمةٍ ويعيد الأرقام.
//    (الكتابةُ الوحيدةُ الممكنة: **حدُّ الفترة الشهريّة** عند ضغط «شهر جديد» — إعدادٌ لا مال.)

/** يحلّ المدى: شهريّاً (بلا كتابة تواريخ) · مخصّصاً · أو الفترة الجارية */
async function resolveRange(agentId: number, sp: URLSearchParams) {
  const month = (sp.get("month") ?? "").trim(); // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const r = monthRange(y, m - 1);
    return { ...r, label: monthLabel(r.from), warning: null as string | null, ended: false, mode: "month" as const };
  }
  const fromTxt = sp.get("from"), toTxt = sp.get("to");
  if (fromTxt && toTxt) {
    const from = new Date(`${fromTxt}T00:00:00+03:00`);
    const to = new Date(`${toTxt}T23:59:59.999+03:00`);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && to >= from) {
      return { from, to, label: monthLabel(from), warning: rangeWarning(from, to), ended: false, mode: "custom" as const };
    }
  }
  const p = await getPeriod(agentId);
  return { from: p.from, to: p.to, label: p.label, warning: null as string | null, ended: p.ended, mode: "current" as const };
}

export async function GET(req: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const towers = await agentTowerIds(g.session ?? null);
  const sp = new URL(req.url).searchParams;

  // 🏢 **ترشيحُ مكتب** (طلبُ محمد 2026-08-22): رقمٌ من مكاتبه ⇒ أرقامُ ذلك المكتب وحدَه،
  //    وبلا رقمٍ ⇒ المجموعُ كما كان. وأيُّ رقمٍ خارج مكاتبه يسقط (عزلٌ لا خيار).
  const askTower = Number(sp.get("tower")) || 0;
  const scope = askTower && towers.includes(askTower) ? [askTower] : towers;

  const range = await resolveRange(agentId, sp);
  const period = await getPeriod(agentId);
  // 🚧 «يبدأ كلُّ شيءٍ من الآن»: لا يُحسَب ما قبل لحظة التأسيس مهما اتّسع المدى المطلوب
  const from = range.from < period.epoch ? period.epoch : range.from;

  const report = await computeProfits(agentId, scope, from, range.to);
  const bp = baghdadParts(range.from);
  const view = await getSavedView(g.session?.userId ?? -1);
  return NextResponse.json({
    view,
    ...report,
    from: from.toISOString(), to: range.to.toISOString(),
    label: range.label, warning: range.warning, mode: range.mode,
    monthValue: `${bp.y}-${String(bp.m + 1).padStart(2, "0")}`,
    tower: askTower && towers.includes(askTower) ? askTower : 0,
    period: {
      from: period.from.toISOString(), to: period.to.toISOString(),
      label: period.label, ended: period.ended, epoch: period.epoch.toISOString(),
    },
  });
}

/** 💾 حفظُ اختيار العرض (شهريّ/مخصّص/الجاري + المكتب) على حساب المستخدم — إعدادُ عرضٍ لا مال. */
export async function PUT(req: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  await saveView(g.session?.userId ?? -1, {
    mode: typeof b.mode === "string" ? b.mode : "current",
    month: typeof b.month === "string" ? b.month : "",
    from: typeof b.from === "string" ? b.from : "",
    to: typeof b.to === "string" ? b.to : "",
    tower: Number(b.tower) || 0,
  });
  return NextResponse.json({ ok: true });
}

/** «شهر جديد» — يطوي الفترةَ الحاليّة ويبدأ التالية. إعدادٌ فقط، ولا يمسّ مالاً ولا بياناتٍ. */
export async function POST() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  // 🔒 **لا يُبدأ شهرٌ جديدٌ قبل انقضاء الحاليّ** (تصحيحُ محمد 2026-08-22) — والخادمُ يحكم
  //    لا الواجهةُ وحدَها، فلا يُصفَّر شهرٌ في منتصفه بضغطةٍ سهوٍ أو بنداءٍ مباشر.
  const cur = await getPeriod(agentId);
  if (!cur.ended) {
    return NextResponse.json({
      error: "لم ينتهِ الشهرُ الحاليُّ بعد — يُفتَح زرُّ «شهر جديد» بعد آخر يومٍ فيه",
      period: { from: cur.from.toISOString(), to: cur.to.toISOString(), label: cur.label, ended: false },
    }, { status: 400 });
  }
  const p = await startNewMonth(agentId);
  return NextResponse.json({
    ok: true,
    period: { from: p.from.toISOString(), to: p.to.toISOString(), label: p.label, ended: p.ended },
  });
}
