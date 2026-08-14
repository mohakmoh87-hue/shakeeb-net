import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { proxyToSas } from "@/lib/sasProxy";
import { meter } from "@/app/api/_lib/egressMeter";
import { cookies } from "next/headers";
import { parseSasScope, sasScopeSegment } from "@/lib/sasScope";
import { sasBaseUrl, sasLogin } from "@/lib/sas4";

// أصول ثابتة (JS/CSS/صور/خطوط) — غير حسّاسة، نتخطّى فحص الملكية عليها للحفاظ على سرعة تحميل اللوحة
const ASSET_RE = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|ico|map|json|txt)$/i;

// بروكسي أصول لوحة SAS4 (index.html + JS/CSS) عبر origin البرنامج
const hostCache = new Map<string, string>();
// أ-٢٣ · مُخدِّمُ الساس: من **اللوحة** إن طُلبت (`?panel=`)، وإلّا أعمدةُ المكتب (السلوكُ القديم).
// ومكتبٌ بلوحتَين على مُخدِّمَين مختلفَين يفتح لوحةَ كلٍّ منهما من هنا.
async function sasHost(towerId: number, panelId: number | null): Promise<string | null> {
  const key = `${towerId}:${panelId ?? 0}`;
  if (hostCache.has(key)) return hostCache.get(key)!;
  let loginUrl: string | null = null;
  if (panelId != null) {
    // 🔒 اللوحةُ يجب أن تتبع هذا المكتب — وإلّا فُتحت لوحةُ مكتبٍ آخرَ بتمرير معرّف
    const p = await prisma.sasPanel.findFirst({ where: { id: panelId, towerId, isDeleted: false }, select: { loginUrl: true } });
    loginUrl = p?.loginUrl ?? null;
  }
  if (!loginUrl) {
    const tower = await prisma.tower.findUnique({ where: { id: towerId }, select: { loginUrl: true } });
    loginUrl = tower?.loginUrl ?? null;
  }
  if (!loginUrl) return null;
  const host = loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  hostCache.set(key, host);
  return host;
}

// ═════ 🔑 رمزُ لوحةٍ بعينها للوسيط السحابيّ ═════
// يُفرَض على نداءات اللوحة بدلَ رمزِ المتصفّح المشترك (انظر `authOverride` في sasProxy).
// ومخزنٌ لكلّ نطاقٍ **إلزاميّ**: بلاه تسجيلُ دخولٍ للساس مع كلّ نداءٍ — بطءٌ على المستخدم
// وعبءٌ على مُخدِّم الساس. والمهلةُ أقصرُ من عمر رمز الساس فلا يُستعمل رمزٌ منتهٍ.
const scopedTokenCache = new Map<string, { token: string; at: number }>();
const SCOPED_TOKEN_TTL = 4 * 60 * 1000;

async function scopedSasToken(towerId: number, panelId: number | null): Promise<string> {
  const key = panelId != null ? `p${panelId}` : `t${towerId}`;
  const hit = scopedTokenCache.get(key);
  if (hit && Date.now() - hit.at < SCOPED_TOKEN_TTL) return hit.token;
  // 🔒 العزل: `credsOfPanel` تُقيَّد بلوحةٍ **لهذا المكتب** — والمكتبُ فُحص بـ`ownsTower`
  const creds = panelId != null
    ? await prisma.sasPanel.findFirst({
        where: { id: panelId, towerId, isDeleted: false },
        select: { loginUrl: true, username: true, password: true },
      })
    : await prisma.tower.findUnique({ where: { id: towerId }, select: { loginUrl: true, username: true, password: true } });
  if (!creds?.loginUrl || !creds.username || !creds.password) return "";
  const token = await sasLogin(sasBaseUrl(creds.loginUrl), creds.username, creds.password);
  scopedTokenCache.set(key, { token, at: Date.now() });
  return token;
}

async function handle(request: Request, towerSeg: string, path: string[] | undefined) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  // ═════ 🔴 اللوحةُ تُقرأ من **المسار** أوّلاً (بلاغُ صميم — الارتدادُ الثاني) ═════
  // الكعكةُ `sas_panel` تحلّ مشكلةَ «الطلباتُ الداخليّةُ بلا معامل» — لكنّها **لكلّ
  // المتصفّح**: فتحُ اللوحة الثانية يُبدّلها، فتصير طلباتُ تبويبِ اللوحةِ الأولى المفتوحِ
  // تذهب إلى الثانية ⇒ «Access Denied» في تبويبٍ لم يُلمَس. والمسارُ ملكُ التبويب،
  // ويورَّث للطلبات النسبيّة عبر `<base href>` ⇒ لا خانةَ مشتركةً تُتقاتَل عليها.
  // وتبقى الكعكةُ والمعاملُ مقبولَين للتبويبات المفتوحة الآن — فلا يُكسَر عملٌ جارٍ.
  const scope = parseSasScope(towerSeg);
  if (!scope) return new Response("bad tower", { status: 400 });
  const towerId = String(scope.towerId);
  const joined = (path ?? []).join("/");
  // عزل المستأجر: نفرض ملكية المكتب على مستند الدخول وأي مسار غير أصول ثابتة
  // (الأصول تُتخطّى للسرعة، وهي غير حسّاسة). يمنع فتح لوحة وكيل آخر.
  const last = (path ?? [])[(path ?? []).length - 1] ?? "";
  if (!ASSET_RE.test(last) && !(await ownsTower(session, Number(towerId)))) {
    return new Response("forbidden", { status: 403 });
  }
  // 🔴 بلاغُ محمد 2026-08-13: «الاستيرادُ من الساس الثاني يُظهر مشتركي الساس الأوّل».
  // وصفحةُ الساس **تطبيقٌ أحاديُّ الصفحة**: مستندُها يُطلَب بـ`?panel=11` لكنّ كلَّ طلباتها
  // الداخليّة (api · أصول) تذهب إلى `/sas/<id>/...` **بلا المعامل** ⇒ فكان الوسيطُ يعود في
  // كلّ طلبٍ تالٍ إلى أعمدة المكتب = اللوحةُ الأولى. فتُقرأ اللوحةُ من كوكيٍّ يضبطه مسارُ
  // الرمز (`api/sas4/token`) عند فتح الإطار، ويبقى المعاملُ مُقدَّماً عليه إن وُجد.
  const sp = new URL(request.url).searchParams;
  // الأولويّة: المسارُ (ملكُ التبويب) ← المعاملُ ← الكعكةُ (كلاهما للتوافق مع ما هو مفتوح)
  const panelRaw = sp.get("panel") ?? (await cookies()).get("sas_panel")?.value ?? null;
  const panelId = scope.panelId
    ?? (panelRaw && Number.isInteger(Number(panelRaw)) && Number(panelRaw) > 0 ? Number(panelRaw) : null);
  const host = await sasHost(Number(towerId), panelId);
  if (!host) return new Response("tower not found", { status: 404 });
  // 🔒 واللوحةُ يجب أن تتبع هذا المكتب — والمكتبُ فُحص أعلاه بـ`ownsTower`. و`sasHost`
  //   يسقط إلى أعمدة المكتب إن لم تتبعه، فلا تُفتَح لوحةُ مكتبٍ آخرَ بتمريرِ معرّف.
  // والبادئةُ تحمل **المقطعَ كما وصل** كي تبقى الطلباتُ النسبيّةُ على اللوحة نفسِها.
  const res = await proxyToSas(request, host, joined, `/sas/${sasScopeSegment(Number(towerId), panelId)}/`, undefined,
    () => scopedSasToken(Number(towerId), panelId));
  // 📏 قياسُ النقل (طلبُ محمد 2026-08-15): كم بايتاً تخرج فعلاً من هذا الوسيط؟ الفاتورةُ
  //   تقول «٥٫٣١ غيغا» ولا تقول مِن أين — وهذا الوسيطُ المشتبهُ الأوّل، فكلُّ أصلٍ من
  //   لوحة الساس يعبره ذهاباً وإياباً، والعودةُ هي المدفوعة.
  // ⚠️ ولا يُقاس بـ`content-length`: `proxyToSas` **لا يُصرّح به** (يُعيد `content-type`
  //   و`cache-control` و`location` فقط) — فالقياسُ بالرأس كان سيسجّل صفراً ويُكذّبنا.
  //   فيُقرأ الجسمُ فعليّاً ويُعاد بناءُ الاستجابة: نسخةٌ واحدةٌ لمخزَنٍ **موجودٍ في الذاكرة
  //   أصلاً** (الوسيطُ يجمعه كاملاً قبل الإرسال)، فلا تحميلَ إضافيٌّ يُذكَر.
  // ⛔ وحالاتُ «بلا جسم» تُستثنى **قبل** لمس الجسم: `new Response(body, {status:304})`
  //   يرمي (٢٠٤/٢٠٥/٣٠٤ لا تقبل جسماً)، ولو رميَ بعد `arrayBuffer()` لكان الجسمُ قد
  //   استُهلك فيصير الارتدادُ إلى `res` استجابةً ميّتة — أي **عطبٌ يصنعه القياسُ نفسُه**
  //   في أكثرِ الردود شيوعاً (٣٠٤ لأصلٍ مخزَّنٍ في المتصفّح).
  if (res.status === 204 || res.status === 205 || res.status === 304) return res;
  try {
    const buf = await res.arrayBuffer();
    meter(new URL(request.url).pathname, buf.byteLength);
    return new Response(buf, { status: res.status, headers: res.headers });
  } catch {
    return res; // تعذّرت القراءة (بثٌّ مثلاً) ⇒ تُخدَم كما هي — القياسُ لا يُعطّل خدمة
  }
}

type Ctx = { params: Promise<{ towerId: string; path?: string[] }> };
export async function GET(req: Request, { params }: Ctx) {
  const { towerId, path } = await params;
  return handle(req, towerId, path);
}
export async function POST(req: Request, { params }: Ctx) {
  const { towerId, path } = await params;
  return handle(req, towerId, path);
}
export async function PUT(req: Request, { params }: Ctx) {
  const { towerId, path } = await params;
  return handle(req, towerId, path);
}
export async function DELETE(req: Request, { params }: Ctx) {
  const { towerId, path } = await params;
  return handle(req, towerId, path);
}
