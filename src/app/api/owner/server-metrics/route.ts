import { NextResponse } from "next/server";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";
const pexec = promisify(execFile);

const SERVICES = ["mynet-web", "mynet-web-test", "postgresql", "mynet-backup.timer"];

async function diskInfo() {
  try {
    const { stdout } = await pexec("df", ["-B1", "--output=size,used,avail,pcent", "/"], { timeout: 5000 });
    const parts = (stdout.trim().split("\n").pop() ?? "").trim().split(/\s+/);
    return { totalBytes: Number(parts[0]), usedBytes: Number(parts[1]), freeBytes: Number(parts[2]), pct: parts[3] ?? "" };
  } catch {
    return null;
  }
}

async function serviceStates(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    SERVICES.map(async (s) => {
      try {
        const { stdout } = await pexec("systemctl", ["is-active", s], { timeout: 4000 });
        out[s] = stdout.trim();
      } catch (e) {
        const so = (e as { stdout?: string }).stdout;
        out[s] = so ? so.trim() : "unknown";
      }
    }),
  );
  return out;
}

// مقاييس السيرفر والقاعدة الحيّة (للمالك فقط) — عرضٌ محض، بلا أوامر
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;

  const q = <T,>(sql: string, fb: T[]) => prisma.$queryRawUnsafe<T[]>(sql).catch(() => fb);

  const [disk, services, conns, dbSize, tables, cache] = await Promise.all([
    diskInfo(),
    serviceStates(),
    q<{ total: bigint; active: bigint; idle: bigint; iit: bigint; maxc: string }>(
      `SELECT count(*) FILTER (WHERE backend_type='client backend') AS total,
              count(*) FILTER (WHERE state='active') AS active,
              count(*) FILTER (WHERE state='idle') AS idle,
              count(*) FILTER (WHERE state='idle in transaction') AS iit,
              current_setting('max_connections') AS maxc
       FROM pg_stat_activity`,
      [],
    ),
    q<{ bytes: bigint }>(`SELECT pg_database_size(current_database()) AS bytes`, []),
    q<{ tbl: string; total: bigint; rows: bigint }>(
      `SELECT s.relname::text AS tbl, pg_total_relation_size(s.relid) AS total, s.n_live_tup AS rows
       FROM pg_stat_user_tables s ORDER BY pg_total_relation_size(s.relid) DESC LIMIT 15`,
      [],
    ),
    q<{ ratio: number }>(
      `SELECT round(sum(blks_hit) * 100.0 / NULLIF(sum(blks_hit) + sum(blks_read), 0), 1)::float8 AS ratio FROM pg_stat_database`,
      [],
    ),
  ]);

  const c = conns[0];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return NextResponse.json({
    server: {
      hostname: os.hostname(),
      uptimeSec: Math.round(os.uptime()),
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? "",
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      ramTotal: totalMem,
      ramFree: freeMem,
      ramUsed: totalMem - freeMem,
      disk,
    },
    postgres: {
      sizeBytes: Number(dbSize[0]?.bytes ?? 0),
      connTotal: Number(c?.total ?? 0),
      connActive: Number(c?.active ?? 0),
      connIdle: Number(c?.idle ?? 0),
      connIdleTx: Number(c?.iit ?? 0),
      connMax: Number(c?.maxc ?? 100),
      cacheHitPct: Number(cache[0]?.ratio ?? 0),
      tables: tables.map((t) => ({ table: t.tbl, bytes: Number(t.total), rows: Number(t.rows) })),
    },
    services,
    at: Date.now(),
  });
}
