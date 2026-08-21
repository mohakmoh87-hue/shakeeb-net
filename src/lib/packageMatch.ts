import { prisma } from "@/lib/prisma";

// ===== مطابقة أسماء الباقات بين SAS والبرنامج (2026-08-02) =====
// المشكلة التي عالجها هذا الملف: المطابقة كانت حرفية، فأي فراغ زائد أو تقديم/تأخير
// في كلمات الاسم يجعل باقة SAS «مجهولة» ⇒ المشترك بلا باقة وسعره صفر، ولا يُصحَّح
// تاريخ انتهائه أيضاً. الآن نطابق على مستويين مرتّبين بالثقة، مع قواعد أمان صارمة
// تمنع المطابقة الخاطئة (باقتان مختلفتان لا تُدمجان أبداً).

// تطبيع نصّي: يوحّد الحالة والفراغات وصيغ الحروف العربية والأرقام الهندية.
// لا يمسّ المعنى — فقط ما يختلف كتابةً لا دلالةً.
export function normalizePkgName(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  s = s.toLowerCase();
  // الأرقام العربية الهندية ← اللاتينية (٥٠ ← 50)
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  // التشكيل والتطويل يُحذفان
  s = s.replace(/[ً-ْـ]/g, "");
  // توحيد صيغ الحروف: أ إ آ ← ا · ة ← ه · ى ← ي · ؤ ئ ← و ي
  s = s.replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  // كل ما ليس حرفاً أو رقماً يصير فاصلاً (يعالج - _ / . والفراغات المتعددة)
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return s;
}

// تقطيع إلى وحدات دلالية: يفصل أيضاً عند حدود الأرقام والحروف — فـ«50Mbps» و«50 Mbps»
// يعطيان نفس الوحدات [50, mbps]. (هذا بالضبط ما عطّل باقات جاكوار: كتبها «Hero 50 Mbps +»
// وSAS يكتبها «Hero 50Mbps» — فلم يتطابق شيء وبقي 2067 مشتركاً بلا باقة.)
function pkgTokens(raw: string | null | undefined): string[] {
  const n = normalizePkgName(raw);
  if (!n) return [];
  return n
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .split(" ")
    .filter(Boolean);
}

// مفتاح محافظ على الترتيب بعد توحيد الفراغات والالتصاق
export function pkgSeqKey(raw: string | null | undefined): string {
  return pkgTokens(raw).join(" ");
}

// مفتاح غير حسّاس لترتيب الكلمات: «Hero 50Mbps» = «50 Mbps Hero»
export function pkgWordKey(raw: string | null | undefined): string {
  return pkgTokens(raw).sort().join(" ");
}

// ═════ 🚀 مفتاحُ السرعة — «Offer-50Mbps + (60 Days)» = «Hero 50Mbps +» (بلاغ محمد 2026-08-21) ═════
// قِيس على حسابه: **٩٩ من ١٢٥** صفَّ «فرق باقة» كانت الباقةَ نفسَها بأسماءٍ مختلفة —
// سوبر سيل تسمّيها «Offer-…(60 Days)» وهو يسمّيها «Hero-…». والمُطابِقُ القديم يقارن
// الكلماتِ كلَّها فيفشل، فيُسجَّل فرقٌ **لا يمكن تطبيقُه** (لا باقةَ مقابلة) ⇒ يتكرّر أبداً.
// 🔑 والدلالةُ الحقيقيّةُ في الاسم شيئان لا ثالثَ لهما: **الرقمُ (السرعة) وعلامةُ +**.
//   فما عداهما (اسمُ العلامة · كلمةُ mbps · «(60 Days)» · الشرطات) زخرفةٌ لا تُغيّر الباقة.
// ⚠️ وحارسُ الأمان نفسُه يبقى: مفتاحٌ يقع عليه أكثرُ من باقةٍ يُسقَط ولا يُطابَق أبداً.
const DAYS_SUFFIX = /\(?\s*\d+\s*(days?|يوم|ايام)\s*\)?/gi;
export function pkgSpeedKey(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? "").replace(DAYS_SUFFIX, " ");
  const plus = /\+/.test(cleaned);
  const n = normalizePkgName(cleaned);
  if (!n) return null;
  // أوّلُ رقمٍ يتبعه mbps/mb/m (أو رقمٌ وحيدٌ في الاسم) هو السرعة
  const m = /(\d+)\s*(mbps|mb|m)\b/.exec(n) ?? /^\D*(\d+)\D*$/.exec(n);
  if (!m) return null;
  return `${m[1]}${plus ? "+" : ""}`;
}

export type PkgRow = { id: number; name: string | null; priceDinar?: number | null };

// فهرس مطابقة لباقات وكيل واحد. **قاعدة الأمان**: أي مفتاح يقع عليه أكثر من باقة
// (تعارض) يُسقَط من الفهرس ولا يُطابَق إطلاقاً — إبقاء المشترك بلا باقة أهون بكثير
// من ربطه بباقة خاطئة وسعرٍ خاطئ.
export class PackageMatcher {
  private seq = new Map<string, number>();  // مطابقة بالترتيب (بعد توحيد الفراغات والالتصاق)
  private word = new Map<string, number>(); // مطابقة بلا حساسية للترتيب
  private speed = new Map<string, number>(); // 🚀 مطابقةٌ بالسرعة وعلامة + (تتجاهل العلامة التجاريّة)
  private ambiguous = new Set<string>();

  constructor(packages: PkgRow[]) {
    const seqCount = new Map<string, number>();
    const wordCount = new Map<string, number>();
    const speedCount = new Map<string, number>();
    for (const p of packages) {
      const s = pkgSeqKey(p.name);
      const w = pkgWordKey(p.name);
      if (s) seqCount.set(s, (seqCount.get(s) ?? 0) + 1);
      if (w) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
      const sp = pkgSpeedKey(p.name);
      if (sp) speedCount.set(sp, (speedCount.get(sp) ?? 0) + 1);
    }
    for (const p of packages) {
      const s = pkgSeqKey(p.name);
      const w = pkgWordKey(p.name);
      if (s && (seqCount.get(s) ?? 0) === 1) this.seq.set(s, p.id);
      else if (s) this.ambiguous.add(s);
      if (w && (wordCount.get(w) ?? 0) === 1) this.word.set(w, p.id);
      else if (w) this.ambiguous.add(w);
      const sp = pkgSpeedKey(p.name);
      // سرعةٌ تحملها باقتان (٥٠ و٥٠+ مثلاً) لا تُطابَق بالسرعة — الالتباسُ يُسقِط لا يُخمِّن
      if (sp && (speedCount.get(sp) ?? 0) === 1) this.speed.set(sp, p.id);
    }
  }

  // معرّف الباقة المطابقة، أو null إن لم توجد أو كانت المطابقة ملتبسة
  match(sasName: string | null | undefined): number | null {
    const s = pkgSeqKey(sasName);
    if (!s) return null;
    if (this.ambiguous.has(s)) return null;
    const direct = this.seq.get(s);
    if (direct != null) return direct;
    const w = pkgWordKey(sasName);
    if (w && !this.ambiguous.has(w)) {
      const byWord = this.word.get(w);
      if (byWord != null) return byWord;
    }
    // 🚀 المستوى الثالث: السرعةُ وعلامةُ + (Offer-50Mbps + (60 Days) ⇒ Hero 50Mbps +)
    const sp = pkgSpeedKey(sasName);
    return sp ? (this.speed.get(sp) ?? null) : null;
  }

  // هل اسم فئة SAS معروف لدينا؟ (تُستعمل لقرار «لا تمسّ المشترك ذا الفئة المجهولة»)
  knows(sasName: string | null | undefined): boolean {
    return this.match(sasName) != null;
  }

  get size(): number { return this.seq.size; }
}

// فهرس باقات وكيلٍ بعينه — عزل المستأجر إلزامي: لا تُطابَق باقات وكيل بمشتركي آخر
export async function matcherForAgent(agentId: number | null | undefined): Promise<PackageMatcher> {
  const packages = await prisma.package.findMany({
    where: { isDeleted: false, agentId: agentId ?? -1 },
    select: { id: true, name: true, priceDinar: true },
  });
  return new PackageMatcher(packages);
}

// فهرس باقات وكيل المكتب (المزامنة تعرف المكتب لا الوكيل)
export async function matcherForOffice(officeId: number): Promise<PackageMatcher> {
  const tower = await prisma.tower.findUnique({ where: { id: officeId }, select: { agentId: true } });
  return matcherForAgent(tower?.agentId ?? null);
}
