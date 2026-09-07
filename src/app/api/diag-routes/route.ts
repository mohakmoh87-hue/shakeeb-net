import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const out: Record<string, unknown> = { cwd: process.cwd() };
  const base = process.cwd();
  try {
    const p = path.join(base, ".next", "server", "app-paths-manifest.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    out.manifestCardKeys = Object.keys(j).filter((k) => /cadr|card|dist/i.test(k));
    out.manifestTotal = Object.keys(j).length;
  } catch (e) {
    out.manifestErr = e instanceof Error ? e.message : String(e);
  }
  try {
    out.cadrdistPageExists = fs.existsSync(path.join(base, ".next/server/app/cadrdist/page.js"));
    out.appAdminPageExists = fs.existsSync(path.join(base, ".next/server/app/app-admin/page.js"));
  } catch (e) {
    out.fsErr = e instanceof Error ? e.message : String(e);
  }
  try {
    out.appDir = fs.readdirSync(path.join(base, ".next/server/app")).filter((n) => /cadr|card|admin|about|supercell/i.test(n));
  } catch (e) {
    out.appDirErr = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
