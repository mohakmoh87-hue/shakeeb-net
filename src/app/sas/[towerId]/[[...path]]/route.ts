import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { proxyToSas } from "@/lib/sasProxy";
import { cookies } from "next/headers";

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

async function handle(request: Request, towerId: string, path: string[] | undefined) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
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
  const panelRaw = sp.get("panel") ?? (await cookies()).get("sas_panel")?.value ?? null;
  const panelId = panelRaw && Number.isInteger(Number(panelRaw)) && Number(panelRaw) > 0 ? Number(panelRaw) : null;
  const host = await sasHost(Number(towerId), panelId);
  if (!host) return new Response("tower not found", { status: 404 });
  // البادئةُ تحمل اللوحةَ كي تبقى روابطُ الأصول النسبيّةُ داخل اللوحة نفسِها
  return proxyToSas(request, host, joined, `/sas/${towerId}/`);
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
