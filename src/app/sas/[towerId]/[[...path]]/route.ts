import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { proxyToSas } from "@/lib/sasProxy";

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
  const host = await towerHost(Number(towerId));
  if (!host) return new Response("tower not found", { status: 404 });
  return proxyToSas(request, host, (path ?? []).join("/"), `/sas/${towerId}/`);
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
