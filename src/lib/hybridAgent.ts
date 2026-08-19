import os from "node:os";
import { execFile } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { computeLeaderMachineId, acquireLeadership, releaseLeadership } from "@/lib/hybridLeader";

// حالة القيادة على العامل المحلي: قائد الوكيل فقط يستضيف واتساب مكاتب وكيله.
// الافتراضي false حتى تُحسم أول نبضة (لا يُصبح قائداً إلا بعد اعتماده وربطه بوكيل).
let leaderNow = false;
let myAgentId: number | null = null; // وكيل هذه الحاسبة (يُقرأ من صفّها بعد الاعتماد)
let myTowerId: number | null = null; // مكتب هذه الحاسبة (عزل صارم: تستضيف جلسة مكتبها فقط)
let mid = "";

export function getMachineId(): string {
  if (!mid) mid = process.env.MACHINE_ID || os.hostname() || `worker-${Math.random().toString(36).slice(2, 8)}`;
  return mid;
}

// طابعات هذه الحاسبة (JSON بأسماء) — تُقرأ مرّة كل 5 دقائق وتُرفَع في النبضة ليختار المدير
// طابعة الوصل من قائمةٍ حقيقيّة. عدّة طرق بالترتيب لأنّ WMI (Get-CimInstance Win32_Printer)
// يفشل على بعض الأجهزة (حاسبة الشدن): نبدأ بـGet-Printer (نظام الطباعة الحديث) ثم نرتدّ لـWMI.
let printersCache = "";
let printersAt = 0;

function psNames(command: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { timeout: 20_000, windowsHide: true },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        const names = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        resolve(Array.from(new Set(names)));
      },
    );
  });
}

async function enumeratePrinters(): Promise<string[]> {
  // ١) Get-Printer (يعمل حيث يفشل WMI)
  let names = await psNames("Get-Printer | Select-Object -ExpandProperty Name");
  if (names.length) return names;
  // ٢) pdf-to-printer (WMI) — ارتداد
  try {
    const mod = (await import("pdf-to-printer")) as unknown as { getPrinters?: () => Promise<Array<{ name?: string }>> };
    if (typeof mod.getPrinters === "function") {
      const list = await mod.getPrinters();
      names = Array.from(new Set(list.map((p) => (p?.name ?? "").trim()).filter(Boolean)));
      if (names.length) return names;
    }
  } catch { /* تجاهل */ }
  // ٣) WMI مباشرةً — ارتداد أخير
  return psNames("Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name");
}

async function readPrinters(): Promise<string> {
  if (printersCache && Date.now() - printersAt < 5 * 60_000) return printersCache;
  try {
    const names = await enumeratePrinters();
    if (names.length) { printersCache = JSON.stringify(names); printersAt = Date.now(); }
  } catch { /* أبقِ القديم — لا تُعطّل النبضة لأجل قائمة الطابعات */ }
  return printersCache;
}
export function isLeaderNow(): boolean { return leaderNow; }
// وكيل هذه الحاسبة (لحصر جلسات الواتساب بمكاتب هذا الوكيل)
export function getWorkerAgentId(): number | null { return myAgentId; }
// مكتب هذه الحاسبة المُلزِم (عزل واتساب صارم): إن كان محدَّداً، تستضيف هذه الحاسبة
// جلسة هذا المكتب فقط لا غير — حتى لو وُجدت ملفات جلسات مكاتب أخرى على قرصها.
// null = غير مربوطة (سلوك متوافق قديم: تستضيف ما تملك جلسته).
export function getWorkerTowerId(): number | null { return myTowerId; }

// نبضة دورية: تسجّل هذه الحاسبة وتحدّث حالة القيادة.
export function startHybridAgent() {
  const g = globalThis as unknown as { __hybridAgentStarted?: boolean };
  if (g.__hybridAgentStarted) return;
  g.__hybridAgentStarted = true;

  const id = getMachineId();
  const name = os.hostname();
  const towerId = process.env.WORKER_TOWER_ID ? Number(process.env.WORKER_TOWER_ID) : null;

  // ═════ رقابة(أ) 2026-08-19 · سجلُّ نافذة العامل يُرفَع مع النبضة ═════
  // «النافذةُ صامتةٌ لا أستطيع رؤيتها» شلّ تشخيصَ حادثة الشدن كاملةً. الآن تُلتقَط آخرُ
  // أسطرِ الكونسول في حلقةٍ (بلا مساسٍ بالمخرَج الأصليّ) وتُكتب مع كلّ نبضةٍ فتُقرأ من
  // صفحة «حواسيب النظام الهجين» — أيُّ عطلٍ قادمٍ يُشخَّص من الموقع في دقيقة.
  const gLog = globalThis as unknown as { __waLogRing?: string[]; __waLogPatched?: boolean };
  if (!gLog.__waLogPatched) {
    gLog.__waLogPatched = true;
    gLog.__waLogRing = [];
    const ring = gLog.__waLogRing;
    const stamp = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(11, 19); // توقيت بغداد
    for (const level of ["log", "warn", "error"] as const) {
      const orig = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        try {
          const line = args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
          ring.push(`[${stamp()}] ${line}`.slice(0, 300));
          if (ring.length > 60) ring.splice(0, ring.length - 60);
        } catch { /* الالتقاطُ لا يُعطّل الطباعةَ الأصليّة أبداً */ }
        orig(...args);
      };
    }
  }
  const lastLogText = () => (gLog.__waLogRing ?? []).join("\n").slice(-4000);
  let loggedOk = false;

  let timer: ReturnType<typeof setInterval> | null = null;
  async function beat() {
    try {
      const printers = await readPrinters(); // "" إن تعذّر — لا نكتب فوق القائمة القديمة حينها
      const row = await prisma.hybridWorker.upsert({
        where: { machineId: id },
        // ربط المكتب: env WORKER_TOWER_ID (إن وُجد) يُثبّت/يُصحّح الربط في القاعدة؛
        // وإلا يبقى ما ضبطه المدير مركزياً (لا يُدهَس بـnull عند غياب الـenv)
        update: { lastSeen: new Date(), name, lastLog: lastLogText(), ...(towerId != null ? { towerId } : {}), ...(printers ? { printers } : {}) },
        create: { machineId: id, name, towerId, lastSeen: new Date(), ...(printers ? { printers } : {}) },
        select: { agentId: true, approved: true, blocked: true, towerId: true },
      });
      // محظورة (حذفها المدير): توقّف تماماً — أغلق الواتساب نظيفاً ثم اخرج (لا تعد للظهور)
      if (row.blocked) {
        console.log(`[hybrid-agent] ⛔ هذه الحاسبة (${id}) محظورة من المدير — إيقاف العامل.`);
        leaderNow = false;
        if (timer) { clearInterval(timer); timer = null; }
        try { const { destroyAllWhatsApp } = await import("@/lib/whatsapp"); await destroyAllWhatsApp(); } catch { /* تجاهل */ }
        process.exit(0);
      }
      myAgentId = row.agentId ?? null;
      myTowerId = row.towerId ?? null; // مكتب هذه الحاسبة المُلزِم (عزل واتساب صارم)
      // قائد وكيل هذه الحاسبة فقط (يستضيف واتساب مكاتب هذا الوكيل). غير معتمَد/بلا وكيل ⇒ ليس قائداً.
      if (row.approved && myAgentId != null) {
        // ب-١/الأصل ١ · الأولويّةُ تُحدّد **مَن يستحقّ**، والإجارةُ **مَن يملك**.
        // فحاسبتان قد تريان نفسَيهما مستحقّتَين لحظةَ الانتقال، لكنّ الإجارةَ صفٌّ
        // واحدٌ يُنتزَع ذرّيّاً ⇒ قائدٌ واحدٌ أبداً. ومَن فقد الاستحقاقَ **يُطلقها فوراً**
        // فلا ينتظر القائدُ الجديدُ انتهاءَ المهلة بلا داعٍ.
        const deserves = (await computeLeaderMachineId(myAgentId)) === id;
        if (deserves) {
          leaderNow = await acquireLeadership(myAgentId, id);
        } else {
          if (leaderNow) await releaseLeadership(myAgentId, id);
          leaderNow = false;
        }
      } else {
        if (leaderNow && myAgentId != null) await releaseLeadership(myAgentId, id);
        leaderNow = false;
      }
      if (!loggedOk) { loggedOk = true; console.log(`[hybrid-agent] ✅ سُجّلت الحاسبة (${id}) name=${name} — وكيل=${myAgentId} قائد=${leaderNow}`); }
    } catch (e) {
      console.error("[hybrid-agent] ❌ فشل تسجيل الحاسبة:", e instanceof Error ? e.message : e);
    }
  }
  void beat();
  timer = setInterval(() => { void beat(); }, 20000);
  console.log(`[hybrid-agent] بدأت نبضة الحاسبة (${id})`);
}
