import { NextResponse } from "next/server";
import { getCompanySession } from "@/lib/companyAuth";
import { getCompanyAnalyticsView } from "@/lib/appConfig";
import { computeAgentAnalytics } from "@/lib/agentAnalytics";

export const dynamic = "force-dynamic";

// حدودُ الفترة بتوقيت بغداد (UTC+3، بلا توقيتٍ صيفيّ) — البياناتُ مخزَّنةٌ UTC فنُزيح ونعود.
const BAGHDAD = 3 * 3600_000;
function dayStart(now: Date): Date {
  const b = new Date(now.getTime() + BAGHDAD);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - BAGHDAD);
}
function monthStart(now: Date): Date {
  const b = new Date(now.getTime() + BAGHDAD);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1) - BAGHDAD);
}
function ymdToUtc(ymd: string, endOfDay: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = endOfDay
    ? Date.UTC(+y, +mo - 1, +d, 23, 59, 59, 999) - BAGHDAD
    : Date.UTC(+y, +mo - 1, +d) - BAGHDAD;
  return Number.isNaN(ms) ? null : new Date(ms);
}
function periodRange(period: string | null, d1: string | null, d2: string | null): { from: Date; to: Date } {
  const now = new Date();
  if (period === "day") return { from: dayStart(now), to: now };
  if (period === "range" && d1 && d2) {
    const from = ymdToUtc(d1, false), to = ymdToUtc(d2, true);
    if (from && to && from <= to) return { from, to };
  }
  return { from: monthStart(now), to: now };
}

export async function GET(req: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (s.role !== "manager") return NextResponse.json({ error: "للمدير حصراً" }, { status: 403 });
  const view = await getCompanyAnalyticsView();
  const url = new URL(req.url);
  const { from, to } = periodRange(url.searchParams.get("period"), url.searchParams.get("d1"), url.searchParams.get("d2"));
  const data = await computeAgentAnalytics(view, from, to);
  return NextResponse.json({ ...data, from: from.toISOString(), to: to.toISOString() });
}
