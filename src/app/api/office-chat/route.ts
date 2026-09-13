import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { loadWaChannel } from "@/lib/waChannel";

export const dynamic = "force-dynamic";

const GATEWAY_HOSTS = new Set(["wa.shakeebnet.com"]);

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const officeId = Number(new URL(req.url).searchParams.get("officeId"));
  if (!Number.isFinite(officeId) || officeId <= 0) return NextResponse.json({ error: "مكتب غير صالح" }, { status: 400 });
  if (!(await ownsTower(session, officeId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const cfg = await loadWaChannel(officeId);
  if (!cfg || !cfg.enabled || !cfg.instanceId || !cfg.token) return NextResponse.json({ available: false });
  let host = "";
  try { host = new URL(cfg.baseUrl).host; } catch { /* عنوانٌ غير صالح */ }
  if (!GATEWAY_HOSTS.has(host)) return NextResponse.json({ available: false });

  const instance = /^\d+$/.test(cfg.instanceId) ? `instance${cfg.instanceId}` : cfg.instanceId;
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const sig = crypto.createHmac("sha256", cfg.token).update(`${instance}.${exp}`).digest("base64url");
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/${encodeURIComponent(instance)}?embed=1&auth=${encodeURIComponent(`${exp}.${sig}`)}`;
  return NextResponse.json({ available: true, url });
}
