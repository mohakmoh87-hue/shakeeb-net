import { NextResponse } from "next/server";

// ═════ 🌉 جسرُ العرض التجريبيّ — يربط /app بـ/supercell (خطة محمد 2026-08-28) ═════
//
// «في الوقت الحالي أريد ربط الصفحتين معاً لأرى كيف تمرّ الطلبات، ولاحقاً يتمّ الربط
//  مع صفحة إدارة الفنيين بعد اكتمال الصفحتين تماماً» — فهذا الجسرُ **مؤقّتٌ بطبيعته**
//  ويُهدَم يومَ يُبنى الربطُ الحقيقيّ.
//
// 🔒 عزلٌ تامٌّ عن الموقع الحيّ:
//   · **ذاكرةُ العملية وحدَها** — لا قاعدةَ بيانات ولا كتابةَ قرص؛ تُصفَّر مع كلّ نشرةٍ
//     أو إعادةِ تشغيل (مقبولٌ لعرضٍ تجريبيّ).
//   · صفرُ استيرادٍ من كود الموقع: لا قاعدةَ ولا جلساتِ دخولٍ ولا `@/` — وحارسُ الاختبارات يقفلها.
//   · بياناتُه بياناتُ العرض فقط: طلباتُ تجربةٍ وإعلاناتٌ وخياراتُ مساعدةٍ يديرها محمد.
//   · سقوفٌ صارمة: آخرُ 50 طلباً، نصوصٌ مقصوصة، صورُ الإعلانات ≤ 300KB، وحدُّ إرسالٍ
//     بسيطٌ لكلّ عنوان (20 كتابةً/دقيقة) — فالمسارُ عامٌّ بلا حساب.

type DemoRequest = {
  id: number; at: string; target: "company" | "agent";
  type: string; name: string; user: string; phone: string; note: string;
};
type AdSlot = { text: string; image: string };
type Store = {
  seq: number;
  requests: DemoRequest[];
  ads: Record<string, AdSlot>;
  quick: string[];
};

const DEFAULT_ADS: Record<string, AdSlot> = {
  hero: { text: "⚡ اشترك مع سوبر سيل — إنترنت مستقرّ بسرعات حقيقية وتغطية أوسع", image: "" },
  home2: { text: "🎁 عرض الاشتراك الجديد: أوّل شهر بنصف السعر — اسأل وكيلك الأقرب", image: "" },
  plan: { text: "📶 باقات سوبر سيل تناسب الجميع — من 25 ألفاً شهرياً", image: "" },
  activate: { text: "🚀 فعّل اشتراكك الأوّل اليوم ويصلك الفنّي خلال 24 ساعة", image: "" },
};
const DEFAULT_QUICK = ["طلب صيانة", "طلب تنصيب"];

// globalThis: يبقى عبر HMR في التطوير وعبر الطلبات في الإنتاج (نسخةٌ واحدة)
const g = globalThis as unknown as { __demoPortal?: Store; __demoPortalRate?: Map<string, { n: number; at: number }> };
function store(): Store {
  if (!g.__demoPortal) {
    g.__demoPortal = {
      seq: 100,
      requests: [],
      ads: JSON.parse(JSON.stringify(DEFAULT_ADS)),
      quick: DEFAULT_QUICK.slice(),
    };
  }
  return g.__demoPortal;
}

const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

function rateLimited(req: Request): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "?").split(",")[0].trim();
  if (!g.__demoPortalRate) g.__demoPortalRate = new Map();
  const now = Date.now();
  const r = g.__demoPortalRate.get(ip);
  if (!r || now - r.at > 60_000) { g.__demoPortalRate.set(ip, { n: 1, at: now }); return false; }
  r.n++;
  return r.n > 20;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const s = store();
  return NextResponse.json(
    { ads: s.ads, quick: s.quick, requests: s.requests },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  if (rateLimited(req)) return NextResponse.json({ error: "مهلاً — محاولات كثيرة" }, { status: 429 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const s = store();

  if (b.op === "request") {
    const target = b.target === "agent" ? "agent" as const : "company" as const;
    const r: DemoRequest = {
      id: ++s.seq,
      at: new Date().toISOString(),
      target,
      type: cut(b.type, 40) || "طلب",
      name: cut(b.name, 60),
      user: cut(b.user, 60),
      phone: cut(b.phone, 30),
      note: cut(b.note, 300),
    };
    s.requests.unshift(r);
    if (s.requests.length > 50) s.requests.length = 50;
    return NextResponse.json({ ok: true, id: r.id });
  }

  if (b.op === "ads") {
    const incoming = (b.ads ?? {}) as Record<string, { text?: unknown; image?: unknown }>;
    for (const k of Object.keys(DEFAULT_ADS)) {
      const a = incoming[k];
      if (!a || typeof a !== "object") continue;
      const image = cut(a.image, 400_000);
      // صورةٌ data: فقط (لا روابطَ خارجية تُحقَن للمشتركين) وبسقف ~300KB
      s.ads[k] = {
        text: cut(a.text, 300),
        image: image.startsWith("data:image/") && image.length <= 400_000 ? image : "",
      };
    }
    return NextResponse.json({ ok: true });
  }

  if (b.op === "quick") {
    const list = Array.isArray(b.quick) ? b.quick : [];
    s.quick = list.map((x) => cut(x, 30)).filter(Boolean).slice(0, 12);
    if (!s.quick.length) s.quick = DEFAULT_QUICK.slice();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "عملية غير معروفة" }, { status: 400 });
}
