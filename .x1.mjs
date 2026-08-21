import fs from "node:fs";
const L = (...x) => x.join("\n");
const p = "src/app/api/diag/template-image/route.ts";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const must = (o, n) => { if (!s.includes(o)) throw new Error("diag: " + o.slice(0, 50)); s = s.replace(o, n); };
must(
  L(
    "  // ٤-ب· بصمةُ النسخة من آخر نتيجةِ ترحيلِ إرسال (`build` غائبٌ ⇒ نسخةٌ أقدمُ من هذا البناء)",
  ),
  L(
    "  // ٤-أ· 🏷️ **إصدارُ كودِ كلّ حاسبة** — والعاملُ يكتبه بنفسه عند كلّ إقلاعٍ منذ 2026-07-29",
    "  //      في `system_settings` بمفتاح `workerVer:{machineId}` = `{sha, at}`. فلا حاجةَ",
    "  //      لأيّ إضافةٍ على العامل: نقرأ ما يكتبه أصلاً ونقارنه بإيداع السحابة.",
    "  const vers = await prisma.systemSetting.findMany({",
    "    where: { type: { in: workers.map((w) => `workerVer:${w.machineId}`) } },",
    "    select: { type: true, text: true },",
    "  });",
    "  const verOf = new Map(vers.map((v) => [String(v.type).replace(/^workerVer:/, \"\"), v.text]));",
    "",
    "  // ٤-ب· بصمةُ النسخة من آخر نتيجةِ ترحيلِ إرسال (`build` غائبٌ ⇒ نسخةٌ أقدمُ من هذا البناء)",
  ),
);
must(
  L(
    "    workers: workers.map((w) => ({",
    "      machineId: w.machineId, name: w.displayName ?? w.name, towerId: w.towerId,",
    "      approved: w.approved, lastSeen: w.lastSeen,",
    "      buildLine: (w.lastLog ?? \"\").split(\"\n\").reverse().find((l) => l.includes(\"[build]\")) ?? null,",
    "    })),",
  ),
  L(
    "    workers: workers.map((w) => {",
    "      let sha: string | null = null, bootAt: string | null = null;",
    "      try {",
    "        const v = verOf.get(w.machineId);",
    "        const j = v ? (JSON.parse(v) as { sha?: string; at?: string }) : null;",
    "        sha = j?.sha ?? null; bootAt = j?.at ?? null;",
    "      } catch { /* بصمةٌ غيرُ مقروءة */ }",
    "      return {",
    "        machineId: w.machineId, name: w.displayName ?? w.name, towerId: w.towerId,",
    "        approved: w.approved, lastSeen: w.lastSeen,",
    "        إصدارُ_الكود: sha, أُقلعت: bootAt,",
    "        buildLine: (w.lastLog ?? \"\").split(\"\n\").reverse().find((l) => l.includes(\"[build]\")) ?? null,",
    "      };",
    "    }),",
  ),
);
fs.writeFileSync(p, s);
console.log("diag ok");
