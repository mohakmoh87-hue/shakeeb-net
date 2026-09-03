import { prisma } from "./prisma";

// ═════ إعداداتُ تطبيق المشترك العامّة (طلبُ محمد 2026-08-29) ═════
//
// طبقةٌ **جديدةٌ مضافةٌ بالكامل، صفرُ مساسٍ بكود الوكلاء**: بياناتُ الشركة العامّة —
// الإعلاناتُ والعروض (نصّ+صورة) والاختصاراتُ السريعة + وضعُ الشركة + تفعيلُ البوّابة.
// **بلا بُعد وكيلٍ ولا بيانات مشترك** ⇒ لا تمسّ عزلَ الوكلاء إطلاقاً. مصدرُ حقيقةٍ واحدٌ في
// جدول system_settings القائم (استخدامٌ إضافيّ): يكتبه المالكُ وحسابُ الشركة (**آخرُ من يكتب
// يفوز** — قرار محمد)، ويقرؤه تطبيقُ Flutter عبر `GET /api/app/config` العامّ للقراءة فقط.

export type Ad = { text: string; image: string }; // نصّ + صورة (data: مقيّدة)
export type AppContent = { ads: Record<string, Ad>; offers: Ad[]; quick: string[] };

const CONTENT_KEY = "appContent"; // JSON فيه صورٌ ⇒ يُخزَّن في العمود text
const COMPANY_MODE_KEY = "companyModeEnabled";
const PORTAL_ENABLED_KEY = "supercellPortalEnabled";
const TICKET_DEST_KEY = "ticketDest"; // وجهةُ تذاكر المشتركين: supercell | agent | both

export const AD_SLOTS = ["hero", "home2", "plan", "activate"] as const;
export const MAX_IMG = 300_000; // سقفُ الصورة (data:) — نفسُ حدّ شعار الدخول
export const MAX_TEXT = 400; // سقفُ نصّ الإعلان
export const MAX_OFFERS = 8;
export const MAX_QUICK = 8;

function emptyAd(): Ad { return { text: "", image: "" }; }
export function defaultContent(): AppContent {
  return {
    ads: { hero: emptyAd(), home2: emptyAd(), plan: emptyAd(), activate: emptyAd() },
    offers: [],
    quick: ["طلب صيانة", "طلب تنصيب"],
  };
}

// ── I/O على system_settings (نفسُ نمط owner/account: value للقصير، text للكبير) ──
async function writeVal(type: string, value: string) {
  const r = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { value } });
  else await prisma.systemSetting.create({ data: { type, value } });
}
async function writeText(type: string, text: string) {
  const r = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
}

// نقيّةٌ قابلةٌ للاختبار: تُطهّر الواردَ — تقصّ النصوص، ترفض غيرَ data:image/ (لا روابطَ خارجيّة)،
// تحصر عددَ العروض/الاختصارات، وتُثبّت الخاناتِ الأربع. أمانُ الحقن: لا يصلُ للمشترك إلا data:.
export function sanitizeContent(input: unknown): AppContent {
  const out = defaultContent();
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;
  const cleanAd = (v: unknown): Ad => {
    const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const text = typeof a.text === "string" ? a.text.slice(0, MAX_TEXT) : "";
    let image = typeof a.image === "string" ? a.image : "";
    if (!image.startsWith("data:image/") || image.length > MAX_IMG) image = "";
    return { text, image };
  };
  if (o.ads && typeof o.ads === "object") {
    const src = o.ads as Record<string, unknown>;
    for (const slot of AD_SLOTS) out.ads[slot] = cleanAd(src[slot]);
  }
  if (Array.isArray(o.offers)) {
    out.offers = o.offers.slice(0, MAX_OFFERS).map(cleanAd).filter((a) => a.text || a.image);
  }
  if (Array.isArray(o.quick)) {
    out.quick = o.quick
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim().slice(0, 40))
      .slice(0, MAX_QUICK);
  }
  return out;
}

export async function getAppContent(): Promise<AppContent> {
  const row = await prisma.systemSetting.findFirst({ where: { type: CONTENT_KEY }, select: { text: true } });
  if (!row?.text) return defaultContent();
  try { return sanitizeContent(JSON.parse(row.text)); } catch { return defaultContent(); }
}
export async function setAppContent(input: unknown): Promise<AppContent> {
  const clean = sanitizeContent(input);
  await writeText(CONTENT_KEY, JSON.stringify(clean));
  return clean;
}

export async function getCompanyMode(): Promise<boolean> {
  // الافتراضُ **مفعّل** (الشركةُ ظاهرة كالسلوك الحاليّ) — المالكُ يُطفئه صراحةً بـ"0" ليحجبَ الشركة.
  const row = await prisma.systemSetting.findFirst({ where: { type: COMPANY_MODE_KEY }, select: { value: true } });
  return row?.value !== "0";
}
export async function setCompanyMode(on: boolean) { await writeVal(COMPANY_MODE_KEY, on ? "1" : "0"); }

export async function getPortalEnabled(): Promise<boolean> {
  // الافتراضُ **مفعّل** (تبقى /supercell تعمل كسلوكها الحاليّ) — المالكُ يُطفئها صراحةً بـ"0" فتصير 404.
  const row = await prisma.systemSetting.findFirst({ where: { type: PORTAL_ENABLED_KEY }, select: { value: true } });
  return row?.value !== "0";
}
export async function setPortalEnabled(on: boolean) { await writeVal(PORTAL_ENABLED_KEY, on ? "1" : "0"); }

// ═════ وجهةُ تذاكر المشتركين (طلبُ محمد 2026-08-31): يتحكّم بها المالكُ وحدَه ═════
// «both» = تظهرُ للوكيل (إدارة الفنيين) وللشركة (سوبر سيل) معاً · «agent» = للوكيل فقط ·
// «supercell» = للشركة فقط. الافتراضُ «both». تُصفّي كلَّ سطحٍ ما يعرضه (لا تمسّ التخزين).
export type TicketDest = "supercell" | "agent" | "both";
export async function getTicketDest(): Promise<TicketDest> {
  const row = await prisma.systemSetting.findFirst({ where: { type: TICKET_DEST_KEY }, select: { value: true } });
  return row?.value === "supercell" || row?.value === "agent" ? row.value : "both";
}
export async function setTicketDest(dest: TicketDest) {
  await writeVal(TICKET_DEST_KEY, dest === "supercell" || dest === "agent" ? dest : "both");
}

// ═════ الوجهةُ **الفعليّة** للتذاكر (شرطُ محمد الحاكم 2026-09-01) ═════
// «في حالة إطفاء صفحة سوبر سيل لا يعود لها وجودٌ في أيّ مكان» — فلو كانت الوجهةُ «supercell»
// والبوّابةُ مطفأةٌ لَحُبِست التذاكرُ في بوّابةٍ لا وجودَ لها ⇒ تضيع. لذا: **البوّابةُ مطفأةٌ ⇒
// الوجهةُ «الوكيل» حتماً** (نمطُ `companyMode && portalEnabled` نفسُه)، فتصلُ التذكرةُ وكيلَها
// المعنيَّ مباشرةً (يُعرَفُ من أقرب عامودٍ عند الإنشاء). تُستعمَل في سطوح العرض لا التخزين.
export async function getEffectiveTicketDest(): Promise<TicketDest> {
  const [dest, portal] = await Promise.all([getTicketDest(), getPortalEnabled()]);
  return portal ? dest : "agent";
}

// ═════ كشفُ مشتركي الوكلاء لبوّابة الشركة (القطعة ٧-ب — أخطرُ باب) ═════
// **مطفأٌ افتراضاً** — عكسُ بقيّة الأعلام (companyMode/portalEnabled الافتراضُ مفعّل): هذا كشفٌ
// حسّاسٌ للـPII، فلا يُفتَح إلا بإذن المالك الصريح. الغيابُ ⇒ false.
const SUBS_VISIBLE_KEY = "subscribersVisibleToCompany";
export async function getSubsVisibleToCompany(): Promise<boolean> {
  const row = await prisma.systemSetting.findFirst({ where: { type: SUBS_VISIBLE_KEY }, select: { value: true } });
  return row?.value === "1";
}
export async function setSubsVisibleToCompany(on: boolean) {
  await writeVal(SUBS_VISIBLE_KEY, on ? "1" : "0");
}

// ═════ عرضُ «أداء الوكلاء» في بوّابة الشركة (طلبُ محمد 2026-09-02) ═════
// يتحكّم المالكُ بما تراه سوبر سيل في قسم التحليلات: «tickets» = تذاكرُ الشركة + عدّاداتُ
// المشتركين فقط · «field» = أداءُ لوحة الفنيين فقط · «both» = الاثنان. الافتراضُ «both».
const ANALYTICS_VIEW_KEY = "companyAnalyticsView";
export type AnalyticsView = "tickets" | "field" | "both";
export async function getCompanyAnalyticsView(): Promise<AnalyticsView> {
  const row = await prisma.systemSetting.findFirst({ where: { type: ANALYTICS_VIEW_KEY }, select: { value: true } });
  return row?.value === "tickets" || row?.value === "field" ? row.value : "both";
}
export async function setCompanyAnalyticsView(v: AnalyticsView) {
  await writeVal(ANALYTICS_VIEW_KEY, v === "tickets" || v === "field" ? v : "both");
}

// ═════ بطاقاتُ الشركة: الفئاتُ + المهلةُ الافتراضيّة (طلبُ محمد 2026-09-02) ═════
// الشركةُ ترفع بطاقةً لوكيلٍ بفئةٍ من قائمةٍ قابلةٍ للتحرير ومهلةٍ (ساعات). تُخزَّن في system_settings.
const COMPANY_CATS_KEY = "companyCardCategories";
const COMPANY_SLA_KEY = "companyCardSlaHours";
const DEFAULT_COMPANY_CATS = ["قطع كيبل رئيسي", "شكوى مشترك", "فحص جودة الخدمة", "صيانة برج", "تحديث بيانات نقطة"];
function cleanCats(arr: unknown): string[] {
  return Array.isArray(arr)
    ? [...new Set(arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 80)))].slice(0, 40)
    : [];
}
export async function getCompanyCardCategories(): Promise<string[]> {
  const row = await prisma.systemSetting.findFirst({ where: { type: COMPANY_CATS_KEY }, select: { text: true } });
  if (!row?.text) return DEFAULT_COMPANY_CATS;
  try { const c = cleanCats(JSON.parse(row.text)); return c.length ? c : DEFAULT_COMPANY_CATS; } catch { return DEFAULT_COMPANY_CATS; }
}
export async function setCompanyCardCategories(list: unknown): Promise<string[]> {
  const clean = cleanCats(list);
  await writeText(COMPANY_CATS_KEY, JSON.stringify(clean));
  return clean;
}
export async function getCompanyCardSlaHours(): Promise<number> {
  const row = await prisma.systemSetting.findFirst({ where: { type: COMPANY_SLA_KEY }, select: { value: true } });
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 1 && n <= 720 ? Math.round(n) : 24;
}
export async function setCompanyCardSlaHours(hours: number) {
  await writeVal(COMPANY_SLA_KEY, String(Math.max(1, Math.min(720, Math.round(Number(hours) || 24)))));
}

// فئاتُ «وارد الوكلاء» — يرفعها الوكيلُ للشركة (منفصلةٌ عن فئات بطاقات الشركة). تُدار من الشركة.
const AGENT_INBOX_CATS_KEY = "agentInboxCategories";
const DEFAULT_AGENT_CATS = ["انقطاع رئيسي", "طلب كروت", "مشكلة فوترة", "دعم فنيّ للحاسبة"];
export async function getAgentInboxCategories(): Promise<string[]> {
  const row = await prisma.systemSetting.findFirst({ where: { type: AGENT_INBOX_CATS_KEY }, select: { text: true } });
  if (!row?.text) return DEFAULT_AGENT_CATS;
  try { const c = cleanCats(JSON.parse(row.text)); return c.length ? c : DEFAULT_AGENT_CATS; } catch { return DEFAULT_AGENT_CATS; }
}
export async function setAgentInboxCategories(list: unknown): Promise<string[]> {
  const clean = cleanCats(list);
  await writeText(AGENT_INBOX_CATS_KEY, JSON.stringify(clean));
  return clean;
}

// 🛒 فئاتُ سوق المستعمل — يديرها أدمنُ التطبيق. الغيابُ ⇒ الافتراضيّة.
const MARKET_CATS_KEY = "marketCategories";
const DEFAULT_MARKET_CATS = ["سيارات", "إلكترونيات", "أجهزة منزليّة", "أثاث", "ملابس", "عقارات", "أخرى"];
export async function getMarketCategories(): Promise<string[]> {
  const row = await prisma.systemSetting.findFirst({ where: { type: MARKET_CATS_KEY }, select: { text: true } });
  if (!row?.text) return DEFAULT_MARKET_CATS;
  try { const c = cleanCats(JSON.parse(row.text)); return c.length ? c : DEFAULT_MARKET_CATS; } catch { return DEFAULT_MARKET_CATS; }
}
export async function setMarketCategories(list: unknown): Promise<string[]> {
  const clean = cleanCats(list);
  await writeText(MARKET_CATS_KEY, JSON.stringify(clean));
  return clean;
}

// الحزمةُ الكاملةُ للقراءة العامّة (يقرؤها تطبيقُ Flutter عند الإقلاع)
export async function getPublicAppConfig() {
  const [content, companyMode, portalEnabled] = await Promise.all([
    getAppContent(), getCompanyMode(), getPortalEnabled(),
  ]);
  return { ...content, companyMode: companyMode && portalEnabled, portalEnabled };
}
