import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { proxyToSas } from "@/lib/sasProxy";
import { parseUsersList } from "@/lib/sas4";
import { setLastView } from "@/lib/sasViewCache";

// بروكسي نداءات API للوحة SAS4 التي تُحدّدها اللوحة تلقائياً كـ {origin}/admin/...
// المضيف يُقرأ من كوكي sas_host (يُضبط عند تجهيز العرض المضمّن).
async function handle(request: Request, path: string[] | undefined) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  const store = await cookies();
  const host = store.get("sas_host")?.value;
  if (!host) return new Response("no sas host", { status: 404 });

  const upstreamPath = ["admin", ...(path ?? [])].join("/");

  // التقاط قائمة المستخدمين التي تعرضها اللوحة (index/user)
  const isUsersList = upstreamPath.endsWith("index/user");
  const towerId = Number(store.get("sas_tower")?.value ?? 0);
  const onJson = isUsersList
    ? (text: string) => {
        const users = parseUsersList(text);
        if (users.length > 0) setLastView(session.userId, towerId, users);
      }
    : undefined;

  return proxyToSas(request, host, upstreamPath, undefined, onJson);
}

type Ctx = { params: Promise<{ path?: string[] }> };
export async function GET(req: Request, { params }: Ctx) {
  return handle(req, (await params).path);
}
export async function POST(req: Request, { params }: Ctx) {
  return handle(req, (await params).path);
}
export async function PUT(req: Request, { params }: Ctx) {
  return handle(req, (await params).path);
}
export async function DELETE(req: Request, { params }: Ctx) {
  return handle(req, (await params).path);
}
