import { NextResponse } from "next/server";
import { cardsGuard, getDistWaInfo, setDistWa, isSafeWaBase } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  return NextResponse.json(await getDistWaInfo(g.session.distributorId));
}

export async function POST(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const b = await request.json().catch(() => null);
  const enabled = b?.enabled === true || b?.enabled === "1";
  const baseUrl = typeof b?.baseUrl === "string" ? b.baseUrl.trim() : undefined;
  const instanceId = typeof b?.instanceId === "string" ? b.instanceId : undefined;
  const token = typeof b?.token === "string" ? b.token : undefined;
  if (baseUrl && !isSafeWaBase(baseUrl)) {
    return NextResponse.json({ error: "رابطُ API غير صالح أو غيرُ مسموح — يجب أن يكون http(s) لمضيفٍ عامّ" }, { status: 400 });
  }
  const info = await getDistWaInfo(g.session.distributorId);
  const willInstance = (instanceId ?? info.instanceId).trim().length > 0;
  const willToken = (typeof token === "string" && token.trim() !== "") || info.tokenSet;
  if (enabled && (!willInstance || !willToken)) {
    return NextResponse.json({ error: "للتفعيل أدخِل Instance ID والToken معاً" }, { status: 400 });
  }
  return NextResponse.json(await setDistWa(g.session.distributorId, { enabled, baseUrl, instanceId, token }));
}
