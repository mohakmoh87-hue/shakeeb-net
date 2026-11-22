import { prisma } from "./prisma";

// ═════ 🌐 مزوّدُ خدمة المشترك من عنوانه العامّ (طلبُ محمد 2026-11-22) ═════
//
// نفسُ ما تفعله مواقعُ قياس السرعة: لا «فحصَ» ولا شيءَ من العميل — العنوانُ العامُّ
// يصل الخادمَ مع كلّ طلبٍ لأنّه عنوانُ الإرجاع، ومنه يُعرَف النظامُ الذاتيُّ (ASN)
// ومالكُه من سجلّات RIPE. ولذلك **لا يُقبَل اسمُ المزوّد من التطبيق إطلاقاً**: لو
// قُبل لصار المشتركُ قادراً على ادّعاء أيّ شبكة.

export const SUPERCELL_ASN = 209193; // SuperCell-FTTH — أوّلُ ما قِسناه

// 🔴 **لسوبر سيل أكثرُ من نظامٍ ذاتيٍّ** (بلاغُ محمد 2026-11-22): رأينا
// `SuperCell-FTTH SUPER CELL NETWORK FOR INTERNET SERVICES LTD` على شبكة، و
// `iq-supercell SUPER CELL NETWORK FOR INTERNET SERVICES LTD` على أخرى. فالحكمُ برقمٍ
// واحدٍ مثبّتٍ كان يقول لمشتركٍ على سوبر سيل «لست على شبكة سوبر سيل» **ويعرض اسمَها
// في السطر نفسِه** — تناقضٌ صريح. فصار الحكمُ باسم المالك المسجّل لا برقمٍ واحد.
const SUPERCELL_ASNS = new Set<number>([SUPERCELL_ASN]);
const NAME = /super\s*-?cell/i;
// شرطٌ ثانٍ يمنع الخلط بشركة الألعاب الفنلنديّة Supercell Oy — ولها نظامٌ ذاتيٌّ أيضاً
const CONFIRM = /(network|internet|ftth|fttx|\biq\b|iraq)/i;

export function isSuperCell(asn: number | null, holder: string | null): boolean {
  if (asn != null && SUPERCELL_ASNS.has(asn)) return true;
  if (!holder) return false;
  return NAME.test(holder) && CONFIRM.test(holder);
}

// 🔒 العنوانُ من ترويسة الوسيط (Railway خلف وكيل) — أوّلُ قفزةٍ هي العميل،
//    كما في `rateLimit.ts` تماماً. وما بعدها وكلاءُ الطريق فلا يُعتدّ بها.
export function clientIp(h: Headers): string | null {
  const raw = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  return validIp(raw);
}

// ✅ تحقّقٌ صارمٌ قبل أيّ استعمال — والعنوانُ يدخل رابطاً خارجيّاً لاحقاً،
//    فأيُّ تساهلٍ هنا بابُ حقنٍ (SSRF). ولا نقبل إلّا ما بُني من أرقامٍ ونقاطٍ أو ستّ عشريّةٍ ونقطتَين.
export function validIp(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 45) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split(".").map((n) => Number(n));
    return parts.every((n) => n >= 0 && n <= 255) ? s : null;
  }
  if (/^[0-9a-fA-F:]{2,45}$/.test(s) && s.includes(":")) return s.toLowerCase();
  return null;
}

// 🏠 العناوينُ الخاصّةُ لا مزوّدَ لها (هاتفٌ على شبكةٍ محلّيّةٍ أو اختبارٌ على الحاسبة)
export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  const [a, b] = ip.split(".").map((n) => Number(n));
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}

// مفتاحُ الكاش: الشريحةُ لا العنوان — فمشتركو شبكةٍ واحدةٍ بحثٌ واحدٌ مهما كثروا،
// ولا يخرج من عندنا عنوانُ مشتركٍ بعينه إلّا مرّةً لكلّ شبكةٍ جديدة.
export function cacheKey(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";
  const p = ip.split(".");
  return `${p[0]}.${p[1]}.${p[2]}.0/24`;
}

export type IspInfo = { asn: number | null; holder: string | null; onSuperCell: boolean };

const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // تخصيصُ النظام الذاتيّ لا يتبدّل إلّا نادراً

export async function lookupIsp(ip: string): Promise<IspInfo> {
  const none: IspInfo = { asn: null, holder: null, onSuperCell: false };
  if (isPrivateIp(ip)) return none;
  const prefix = cacheKey(ip);

  try {
    const hit = await prisma.asnCache.findUnique({ where: { prefix } });
    if (hit && Date.now() - hit.fetchedAt.getTime() < FRESH_MS) {
      return { asn: hit.asn, holder: hit.holder, onSuperCell: isSuperCell(hit.asn, hit.holder) };
    }
  } catch {
    // الكاشُ تحسينٌ لا شرط — يُكمَل بلا كاشٍ لو تعذّر
  }

  const fetched = await fetchRipe(ip);
  // 🔑 فشلُ البحث لا يُسقط حفظَ الفحص ولا يُخزَّن فراغاً دائماً: يُخزَّن ما وصل فقط.
  if (fetched) {
    try {
      await prisma.asnCache.upsert({
        where: { prefix },
        create: { prefix, asn: fetched.asn, holder: fetched.holder },
        update: { asn: fetched.asn, holder: fetched.holder, fetchedAt: new Date() },
      });
    } catch {
      // لا يضرّ: البحثُ يتكرّر في المرّة القادمة
    }
    return { ...fetched, onSuperCell: isSuperCell(fetched.asn, fetched.holder) };
  }
  return none;
}

async function fetchRipe(ip: string): Promise<{ asn: number | null; holder: string | null } | null> {
  const safe = validIp(ip);
  if (!safe) return null;
  try {
    const url = `https://stat.ripe.net/data/prefix-overview/data.json?sourceapp=kabina-diag&resource=${encodeURIComponent(safe)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { asns?: Array<{ asn?: number; holder?: string }> } };
    const first = j?.data?.asns?.[0];
    if (!first) return null;
    const asn = typeof first.asn === "number" ? first.asn : Number(first.asn);
    return { asn: Number.isFinite(asn) ? asn : null, holder: typeof first.holder === "string" ? first.holder.slice(0, 160) : null };
  } catch {
    return null;
  }
}

// الاسمُ المعروض: اسمُ المالك كما في السجلّ، وإلّا رقمُ النظام، وإلّا لا شيء
export function ispLabel(info: { asn: number | null; holder: string | null }): string | null {
  if (info.holder) return info.holder;
  if (info.asn != null) return `AS${info.asn}`;
  return null;
}
