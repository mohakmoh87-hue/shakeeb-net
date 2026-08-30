import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { getWaChannelInfo, setWaChannel } from "@/lib/waChannel";

export const dynamic = "force-dynamic";

async function guardOffice(officeId: number) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  if (!can(session, "whatsapp.connect")) {
    return { error: NextResponse.json({ error: "ليس لديك صلاحية ربط/فصل واتساب المكتب" }, { status: 403 }) };
  }
  if (!officeId) return { error: NextResponse.json({ error: "حدّد المكتب" }, { status: 400 }) };
  if (!(await ownsTower(session, officeId))) {
    return { error: NextResponse.json({ error: "لا يمكنك إعداد قناة مكتب آخر" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: Request) {
  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  const g = await guardOffice(officeId);
  if (g.error) return g.error;
  return NextResponse.json(await getWaChannelInfo(officeId));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const officeId = Number(body?.officeId);
  const g = await guardOffice(officeId);
  if (g.error) return g.error;

  const enabled = body?.enabled === true || body?.enabled === "1";
  const instanceId = typeof body?.instanceId === "string" ? body.instanceId : undefined;
  const token = typeof body?.token === "string" ? body.token : undefined;

  const info = await getWaChannelInfo(officeId);
  const willHaveInstance = (instanceId ?? info.instanceId).trim().length > 0;
  const willHaveToken = (typeof token === "string" && token.trim() !== "") || info.tokenSet;
  if (enabled && (!willHaveInstance || !willHaveToken)) {
    return NextResponse.json({ error: "لتفعيل UltraMsg أدخِل Instance ID والToken معاً" }, { status: 400 });
  }

  return NextResponse.json(await setWaChannel(officeId, { enabled, instanceId, token }));
}
