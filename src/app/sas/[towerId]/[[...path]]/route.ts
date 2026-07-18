import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { proxyToSas } from "@/lib/sasProxy";

// أصول ثابتة (JS/CSS/صور/خطوط) — غير حسّاسة، نتخطّى فحص الملكية عليها للحفاظ على سرعة تحميل اللوحة
const ASSET_RE = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|ico|map|json|txt)$/i;

// بروكسي أصول لوحة SAS4 (index.html + JS/CSS) عبر origin البرنامج
const hostCache = new Map<number, string>();
async function towerHost(towerId: number): Promise<string | null> {
  if (hostCache.has(towerId)) return hostCache.get(towerId)!;
  const tower = await prisma.tower.findUnique({ where: { id: towerId } });
  if (!tower?.loginUrl) return null;
  const host = tower.loginUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  hostCache.set(towerId, host);
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
  const host = await towerHost(Number(towerId));
  if (!host) return new Response("tower not found", { status: 404 });
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
