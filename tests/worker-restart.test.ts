import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workerImportGraph, workerRestartTrigger, resolveLocal } from "../src/lib/workerRestart";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const tree = new Set(walk("src"));
const readMany = (list: string[]) => new Map(list.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")] as [string, string]));
const graph = workerImportGraph(tree, readMany);

describe("إعادةُ تشغيل حاسبة المكتب لتحديثٍ يمسّ ملفّاتها فقط", () => {
  test("شجرةُ ملفّات العامل تُحسب من الكود الحاليّ بلا غموض", () => {
    assert.ok(graph, "تعذّر حسابُ ملفّات العامل");
    for (const f of ["src/worker.ts", "src/lib/scheduler.ts", "src/lib/whatsapp.ts", "src/lib/printAgent.ts", "src/lib/workerRestart.ts"]) {
      assert.ok(graph!.has(f), `${f} غائبٌ عن شجرة العامل`);
    }
  });

  test("العاملُ لا يستورد أيَّ ملفٍّ من الصفحات أو المكوّنات", () => {
    const ui = [...graph!].filter((f) => f.startsWith("src/app/") || f.startsWith("src/components/"));
    assert.deepEqual(ui, []);
  });

  test("ملفُّ مكتبةٍ خارج شجرة العامل لا يُعيد التشغيل", () => {
    const outside = [...tree].find((f) => f.startsWith("src/lib/") && f.endsWith(".ts") && !graph!.has(f));
    assert.ok(outside, "لا يوجد ملفُّ مكتبةٍ خارج الشجرة لاختباره");
    assert.equal(workerRestartTrigger([outside!, "src/app/(app)/page.tsx", "docs/x.md"], graph), null);
  });

  test("ملفٌّ داخل شجرة العامل يُعيد التشغيل ويُسمّى سببُه", () => {
    assert.equal(workerRestartTrigger(["src/components/X.tsx", "src/lib/scheduler.ts"], graph), "src/lib/scheduler.ts");
  });

  test("الحزمُ والمخطّطُ وملفُّ التشغيل تُعيد التشغيل دائماً", () => {
    for (const f of ["package.json", "package-lock.json", "prisma/schema.prisma", "worker-loop.cmd", "tsconfig.json", ".npmrc"]) {
      assert.equal(workerRestartTrigger([f], graph), f);
    }
  });

  test("ملفٌّ مجهولٌ خارج src يُعيد التشغيل احتياطاً", () => {
    assert.equal(workerRestartTrigger(["next.config.ts"], graph), "next.config.ts");
  });

  test("تعذُّرُ حساب الشجرة يُرجع السلوكَ القديم: كلُّ ملفٍّ غير واجهةٍ يُعيد التشغيل", () => {
    assert.equal(workerRestartTrigger(["src/lib/salary.ts"], null), "src/lib/salary.ts");
    assert.equal(workerRestartTrigger(["src/app/page.tsx", "docs/x.md"], null), null);
  });

  test("قائمةُ تغييراتٍ فارغة تُعيد التشغيل احتياطاً", () => {
    assert.notEqual(workerRestartTrigger([], graph), null);
  });

  test("استيرادٌ ديناميكيٌّ بمسارٍ متغيّر يُسقط الحسابَ إلى الاحتياط", () => {
    const t = new Set(["src/worker.ts", "src/lib/a.ts"]);
    const src = new Map([["src/worker.ts", 'import "./lib/a";'], ["src/lib/a.ts", "const n = 'x'; await import(`./${n}`);"]]);
    assert.equal(workerImportGraph(t, (list) => new Map(list.map((f) => [f, src.get(f)!] as [string, string]))), null);
  });

  test("ملفٌّ مستوردٌ غيرُ موجودٍ في الشجرة يُسقط الحسابَ إلى الاحتياط", () => {
    const t = new Set(["src/worker.ts"]);
    const src = new Map([["src/worker.ts", 'const m = await import("@/lib/gone");']]);
    assert.equal(workerImportGraph(t, (list) => new Map(list.map((f) => [f, src.get(f)!] as [string, string]))), null);
  });

  test("حلُّ المسارات: الاسمُ المستعار والنسبيّ وملفُّ index والحزم", () => {
    const t = new Set(["src/lib/a.ts", "src/lib/b/index.ts", "src/c.tsx"]);
    assert.equal(resolveLocal("src/worker.ts", "@/lib/a", t), "src/lib/a.ts");
    assert.equal(resolveLocal("src/lib/a.ts", "./b", t), "src/lib/b/index.ts");
    assert.equal(resolveLocal("src/lib/b/index.ts", "../../c", t), "src/c.tsx");
    assert.equal(resolveLocal("src/lib/a.ts", "node:fs", t), null);
    assert.equal(resolveLocal("src/lib/a.ts", "@prisma/client", t), null);
    assert.equal(resolveLocal("src/lib/a.ts", "./missing", t), undefined);
  });
});
