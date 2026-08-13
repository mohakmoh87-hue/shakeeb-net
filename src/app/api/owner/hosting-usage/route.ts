import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// استخدام الاستضافة — مهمّةُ GitHub مجدولةٌ تقيس وترسل هنا (POST محميّ بـCRON_SECRET)،
// ولوحةُ المالك تقرأ (GET محميّ بجلسة المالك). التطبيقُ نفسُه لا يملك بيانات اعتمادِ مزوّد.
//
// ═════ أ-٢٠ · الرقمُ كان صادقاً واسمُه كاذباً (2026-08-13) ═════
// 🔴 هذه النقطةُ بُنيت لأزور وحدَه: منحةٌ شهريّةٌ ثابتةٌ في الكود، وعنوانٌ في اللوحة
//   يقول «استخدامُ الاستضافة». والإنتاجُ انتقل إلى **Railway** ليلةَ 2026-08-12، وأزور
//   بقي **احتياطيّاً خامداً**. فالقياسُ الواصلُ صحيحٌ (٠ طلبات · ١٢ ثانية-معالج) لكنّه
//   قياسُ **الاحتياطيّ الخامد** يُعرَض على محمد كأنّه استخدامُ موقعِه الحيّ ⇒ الرقمُ
//   المطمئنُ الذي يراه كلَّ يومٍ لا علاقةَ له بما يعمل فعلاً.
// ⇒ صار المخزَنُ **لكلّ مزوّدٍ صفَّه**، ولكلّ مزوّدٍ **اسمُه ودورُه** في اللوحة. ولا
//   شيءَ يُحذَف: مهمّةُ أزور تبقى كما هي ويبقى قياسُها ظاهراً — لكن باسمه الصحيح.
//
// 🔑 **ولا دولاراتٌ مُختلقة**: واجهةُ Railway البرمجيّة (`estimatedUsage`) تُرجع وحداتٍ
//   خامّاً (CPU · ذاكرة · قرص · شبكة) **ولا تُرجع كلفةً** — قِيس بالاستكشاف الحيّ
//   للمخطَّط: لا قيمةَ `COST` في `MetricMeasurement` إطلاقاً. فضربُها بجدولِ أسعارٍ
//   من الذاكرة يُنتج كذبةً ثانيةً محلَّ الأولى ⇒ تُعرَض الوحداتُ كما قِيست، والكلفةُ
//   تُقرأ من لوحة Railway نفسِها. **رقمٌ ناقصٌ صادقٌ خيرٌ من رقمٍ كاملٍ مُختلق.**
const KEY = "hosting:usage"; // أزور (تاريخيّ — لا يُغيَّر لئلّا تنكسر مهمّتُه القائمة)
const KEY_OF = (provider: string) => (provider === "azure" ? KEY : `hosting:usage:${provider}`);

/** المزوّدون المعروفون ودورُهم — الدورُ هو ما كان غائباً فصار الرقمُ مضلِّلاً. */
const PROVIDERS: Record<string, { label: string; role: string; primary: boolean }> = {
  railway: { label: "Railway", role: "الإنتاج — الموقعُ يعمل من هنا", primary: true },
  azure: { label: "Azure Container Apps", role: "احتياطيٌّ خامد", primary: false },
};

/** قياسٌ عامٌّ بوحدتِه — لا حدَّ ولا نسبةَ إن لم تكن هناك منحةٌ حقيقيّة. */
type Gauge = { key: string; label: string; value: number; unit: string };

// المنحة المجانية الدائمة لـ Azure Container Apps (تتجدّد شهرياً)
const GRANT = {
  requests: 2_000_000, // طلب/شهر
  vcpuSeconds: 180_000, // ثانية-معالج/شهر
  gibSeconds: 360_000, // GiB-ثانية ذاكرة/شهر
};

type Usage = {
  month: string; // YYYY-MM
  requests: number;
  vcpuSeconds?: number;
  gibSeconds?: number;
  updatedAt: string; // ISO
  source?: string;
  // أ-٢٠ · قياساتٌ عامّةٌ بوحداتها (Railway) — لا منحةَ ولا نسبةَ تُختلق لها
  gauges?: Gauge[];
};

// ===== استقبال القياس من المهمة المجدولة (Bearer CRON_SECRET، نفس نمط كرون auto-checkout) =====
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as (Partial<Usage> & { provider?: string }) | null;
  // أ-٢٠ · `provider` اختياريٌّ ويسقط إلى "azure": فمهمّةُ أزور القائمةُ لا تُرسله،
  // وكسرُها لأجل بندِ تسميةٍ يُفقد قياساً حيّاً. **إضافةٌ لا استبدال.**
  const provider = typeof body?.provider === "string" && PROVIDERS[body.provider] ? body.provider : "azure";
  const gauges: Gauge[] = Array.isArray(body?.gauges)
    ? body!.gauges!
        .filter((g): g is Gauge => !!g && typeof g.key === "string" && typeof g.value === "number" && Number.isFinite(g.value))
        .slice(0, 12)
        .map((g) => ({
          key: g.key.slice(0, 40),
          label: String(g.label ?? g.key).slice(0, 60),
          value: Math.max(0, Math.round(g.value * 1000) / 1000),
          unit: String(g.unit ?? "").slice(0, 20),
        }))
    : [];
  // يُقبَل أحدُ الشكلَين: `requests` (أزور) أو `gauges` (عامّ) — ولا يُقبَل فراغٌ صامتٌ
  if (!body || (typeof body.requests !== "number" && !gauges.length)) {
    return NextResponse.json({ error: "requests (عدد) أو gauges (مصفوفة) مطلوب" }, { status: 400 });
  }
  const usage: Usage = {
    month: typeof body.month === "string" ? body.month : new Date().toISOString().slice(0, 7),
    requests: typeof body.requests === "number" ? Math.max(0, Math.round(body.requests)) : 0,
    vcpuSeconds: typeof body.vcpuSeconds === "number" ? Math.max(0, Math.round(body.vcpuSeconds)) : undefined,
    gibSeconds: typeof body.gibSeconds === "number" ? Math.max(0, Math.round(body.gibSeconds)) : undefined,
    updatedAt: new Date().toISOString(),
    source: typeof body.source === "string" ? body.source.slice(0, 40) : `${provider}-monitor`,
    ...(gauges.length ? { gauges } : {}),
  };
  const json = JSON.stringify(usage);
  const type = KEY_OF(provider);
  const existing = await prisma.systemSetting.findFirst({ where: { type }, orderBy: { id: "asc" } });
  if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { text: json } });
  else await prisma.systemSetting.create({ data: { type, text: json } });
  return NextResponse.json({ ok: true, provider, stored: usage });
}

// ===== قراءة للوحة المالك: الاستخدام المخزَّن + حدود المنحة + النسب المحسوبة =====
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;

  const nowMonth = new Date().toISOString().slice(0, 7);
  const pct = (used: number, limit: number) => Math.round((used / limit) * 1000) / 10;

  // ═════ أ-٢٠ · كلُّ مزوّدٍ باسمه ودوره ═════
  const rows = await prisma.systemSetting.findMany({
    where: { type: { in: Object.keys(PROVIDERS).map(KEY_OF) } },
    select: { type: true, text: true },
    orderBy: { id: "asc" },
  });
  const byType = new Map(rows.map((r) => [r.type, r.text]));
  const providers = Object.entries(PROVIDERS).map(([id, meta]) => {
    const txt = byType.get(KEY_OF(id));
    let u: Usage | null = null;
    if (txt) { try { u = JSON.parse(txt) as Usage; } catch { u = null; } }
    // شهرٌ جديدٌ لم يصله قياسٌ ⇒ **«لا قياس»** صريحةً لا صفرٌ يُقرأ اطمئناناً
    const f = u && u.month === nowMonth ? u : null;
    return {
      id, label: meta.label, role: meta.role, primary: meta.primary,
      hasData: !!f,
      updatedAt: f?.updatedAt ?? null,
      source: f?.source ?? null,
      // القياساتُ كما وردت بوحداتها — بلا حدٍّ ولا نسبةٍ لمزوّدٍ لا منحةَ له
      gauges: f?.gauges ?? [],
      // خانّاتُ أزور التاريخيّة (تبقى لأنّ منحتَه حقيقيّةٌ ومقيسة)
      legacy: id === "azure" && f
        ? {
            grant: GRANT,
            requests: { used: f.requests, limit: GRANT.requests, freePct: pct(f.requests, GRANT.requests), remaining: Math.max(0, GRANT.requests - f.requests) },
            vcpuSeconds: f.vcpuSeconds != null ? { used: f.vcpuSeconds, limit: GRANT.vcpuSeconds, freePct: pct(f.vcpuSeconds, GRANT.vcpuSeconds) } : null,
            gibSeconds: f.gibSeconds != null ? { used: f.gibSeconds, limit: GRANT.gibSeconds, freePct: pct(f.gibSeconds, GRANT.gibSeconds) } : null,
          }
        : null,
    };
  }).sort((a, b) => Number(b.primary) - Number(a.primary)); // الإنتاجُ أوّلاً

  const azure = providers.find((p) => p.id === "azure");
  const u: Usage | null = (() => {
    const txt = byType.get(KEY);
    if (!txt) return null;
    try { const x = JSON.parse(txt) as Usage; return x.month === nowMonth ? x : null; } catch { return null; }
  })();
  const fresh = u;
  const requests = fresh?.requests ?? 0;

  return NextResponse.json({
    // الجديدُ: مصفوفةُ المزوّدين بأدوارهم
    providers,
    // ⚠️ وما دونه **متوافقٌ مع القديم حرفيّاً** فلا تنكسر اللوحةُ قبل نشرِ واجهتها
    // (قاعدة «التغييرُ إضافيٌّ ما دام نشرٌ أقدمُ حيّاً») — وهي أرقامُ أزور نفسُها.
    hasData: !!fresh,
    provider: "azure",
    month: nowMonth,
    updatedAt: fresh?.updatedAt ?? null,
    grant: GRANT,
    azureRole: azure?.role ?? null,
    requests: {
      used: requests,
      limit: GRANT.requests,
      freePct: pct(requests, GRANT.requests),
      remaining: Math.max(0, GRANT.requests - requests),
    },
    vcpuSeconds: fresh?.vcpuSeconds != null
      ? { used: fresh.vcpuSeconds, limit: GRANT.vcpuSeconds, freePct: pct(fresh.vcpuSeconds, GRANT.vcpuSeconds) }
      : null,
    gibSeconds: fresh?.gibSeconds != null
      ? { used: fresh.gibSeconds, limit: GRANT.gibSeconds, freePct: pct(fresh.gibSeconds, GRANT.gibSeconds) }
      : null,
  });
}
