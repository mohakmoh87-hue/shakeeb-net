import fs from "node:fs";
import path from "node:path";

// موضعُ كروم لتشغيل puppeteer — يُشارَك بين واتساب وعامل الطباعة.
export function puppeteerChromeExists(): boolean {
  const home = process.env.USERPROFILE;
  if (!home) return false;
  const dir = path.join(home, ".cache", "puppeteer", "chrome");
  try {
    if (fs.existsSync(dir)) {
      return fs.readdirSync(dir).some((v) => {
        try { return fs.existsSync(path.join(dir, v, "chrome-win64", "chrome.exe")); } catch { return false; }
      });
    }
  } catch { /* */ }
  return false;
}

export function findSystemChrome(): string | undefined {
  const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env["LOCALAPPDATA"]];
  for (const r of roots) {
    if (!r) continue;
    const exe = path.join(r, "Google", "Chrome", "Application", "chrome.exe");
    try { if (fs.existsSync(exe)) return exe; } catch { /* */ }
  }
  return undefined;
}
