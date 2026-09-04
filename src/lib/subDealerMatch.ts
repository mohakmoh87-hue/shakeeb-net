import { normalizePkgName } from "@/lib/packageMatch";

// ═════ كشفُ «سب-ديلر» (سرقةُ المشتركين) — مُطابِقٌ عربيٌّ متعدّدُ الإشارات (طلبُ محمد 2026-09-04) ═════
// يقارن مشتركي ساسِ الوكيل (منتهين) بمشتركي الساس الموحّد (مفعّلين، بحساب وكيلٍ آخر) بالاسم/الهاتف،
// ويرتّب المشتبَه بهم بدرجة ثقة. الفلترُ: منتهٍ عندي + مفعّلٌ في الموحّد بيوزرٍ ليس منّي.

export type SasSub = {
  sasId: number; username: string; name: string | null; phone: string | null;
  expiration: string | null; days: number; enabled: boolean; packageName: string | null;
  activatedAt?: string | null; // من تقرير التفعيلات (للموحّد)
};

export type MatchCandidate = {
  mine: SasSub; suspect: SasSub; score: number; signals: string[]; gapDays: number | null;
};

// أدواتُ «عبد/أبو/أم…» المركّبة تُدمَج مع الكلمة التالية كوحدةٍ واحدة (عبد الكاظم = جزءٌ واحد)
const COMPOUND = new Set(["عبد", "ابو", "ام", "ابن", "بنت", "امير", "نور", "سيد"]);
// كلماتُ حشوٍ شائعةٌ تُلحَق بالأسماء في بياناتنا (طلبات/ملاحظات) — تُزال
const NOISE = new Set(["طلب", "الف", "مال", "الشركه", "تم", "رفض", "الموحده", "بطاقه", "السكن", "ملاحظه", "دينار", "قرض", "جديد", "قديم"]);

// أجزاءُ الاسم مُطبَّعةً ومركّبةً ومنقّاةً من الحشو والأرقام
export function nameParts(raw: string | null | undefined): string[] {
  const n = normalizePkgName(raw);
  if (!n) return [];
  const words = n.split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (/^\d+$/.test(w) || NOISE.has(w)) continue; // رقمٌ أو حشوٌ ⇒ يُطرَح
    if (COMPOUND.has(w) && i + 1 < words.length) { w = w + words[++i]; } // «عبد» + التالي
    if (w.length >= 2) out.push(w);
  }
  return out;
}

// آخرُ ١٠ أرقامٍ من الهاتف (عراقيٌّ ١١ رقماً بصفرٍ بادئ) — صفرٌ إن قصُر/فرغ
function normPhone(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

const eqArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const isPrefix = (a: string[], b: string[]) => a.length > 0 && a.length < b.length && a.every((x, i) => x === b[i]);

type Prep = { sub: SasSub; parts: string[]; phone: string };
const prepare = (s: SasSub): Prep => ({ sub: s, parts: nameParts(s.name), phone: normPhone(s.phone) });

// درجةُ التطابق (بأجزاءٍ محسوبةٍ سلفاً) — الأقوى تحدّد الدرجة. **لا يُطابَق على اسمٍ أوّلٍ شائعٍ وحده**:
// كلُّ إشارةٍ تعبر العتبةَ تتضمّن الهاتفَ أو **سلسلةَ العائلة** (الأب+الجدّ) لا اسماً مفرداً.
function scorePrep(m: Prep, s: Prep): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  if (m.phone && m.phone === s.phone) { score = 100; signals.push("هاتف مطابق"); }
  const mt = m.parts, st = s.parts;
  if (mt.length && st.length) {
    if (eqArr(mt, st)) { score = Math.max(score, 90); signals.push("اسمٌ كامل"); }
    else if (isPrefix(mt, st) || isPrefix(st, mt)) { score = Math.max(score, 80); signals.push("اسمٌ ناقصُ لقب"); }
    else if (mt.length >= 2 && st.length >= 2 && mt[0] === st[0] && mt[1] === st[1]) { score = Math.max(score, 65); signals.push("الأوّل والأب"); }
    // باسم الأب (سلسلةٌ متتالية): أوّلُ الجديد=أبي وثاني الجديد=جدّي — لا اسمٌ مفردٌ شائع
    else if (mt.length >= 3 && st.length >= 2 && st[0] === mt[1] && st[1] === mt[2]) { score = Math.max(score, 55); signals.push("باسم الأب (سلسلة)"); }
    else if (mt.length >= 3 && st.length >= 3 && mt[1] === st[1] && mt[2] === st[2] && mt[0] !== st[0]) { score = Math.max(score, 50); signals.push("أخٌ (الأب والجدّ)"); }
    else {
      const shared = mt.filter((t) => st.includes(t) && t.length >= 3);
      if (shared.length >= 3) { score = Math.max(score, Math.min(65, 30 + shared.length * 12)); signals.push(`تشابهُ ${shared.length} أجزاء`); }
    }
  }
  return { score, signals };
}

// واجهةٌ للاختبار (تحسب الأجزاء لكلّ نداء) — الحلقةُ الفعليّة تستعمل scorePrep بأجزاءٍ محسوبةٍ سلفاً.
export function scoreMatch(mine: SasSub, suspect: SasSub): { score: number; signals: string[] } {
  return scorePrep(prepare(mine), prepare(suspect));
}

// الفرقُ بالأيّام بين انتهاء مشتركي وتفعيل المشتبَه (موجبٌ = فُعِّل بعد انتهائه — أرجحُ للسرقة)
function gapDays(mineExp: string | null, suspectAct: string | null | undefined): number | null {
  if (!mineExp || !suspectAct) return null;
  const e = new Date(mineExp).getTime(), a = new Date(suspectAct).getTime();
  if (isNaN(e) || isNaN(a)) return null;
  return Math.round((a - e) / (24 * 60 * 60 * 1000));
}

// المقارنة الكاملة: مشتركيَ المنتهون × مشتركو الموحّد المفعّلون (بيوزرٍ ليس منّي)، فوق العتبة.
export function findSuspects(mine: SasSub[], unified: SasSub[], threshold = 45): MatchCandidate[] {
  const myUsers = new Set(mine.map((m) => (m.username ?? "").trim().toLowerCase()).filter(Boolean));
  // المشتبَه بهم: مفعّلون في الموحّد وليسوا من حساباتي (فهم حساب الوكيل الآخر) — أجزاؤهم محسوبةٌ مرّةً
  const suspects = unified
    .filter((u) => u.enabled && u.days > 0 && !myUsers.has((u.username ?? "").trim().toLowerCase()))
    .map(prepare);
  // مشتركيَ المنتهون: انتهى فعلاً (days<=0) وله تاريخُ انتهاءٍ حقيقيّ (لا فارغ ⇒ days=0 زائف)
  const expired = mine.filter((m) => m.days <= 0 && m.expiration != null).map(prepare);
  const out: MatchCandidate[] = [];
  for (const m of expired) {
    let best: MatchCandidate | null = null;
    for (const s of suspects) {
      const { score, signals } = scorePrep(m, s);
      if (score < threshold) continue;
      if (!best || score > best.score) best = { mine: m.sub, suspect: s.sub, score, signals, gapDays: gapDays(m.sub.expiration, s.sub.activatedAt) };
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => b.score - a.score || (b.gapDays ?? -1e9) - (a.gapDays ?? -1e9));
  return out;
}
