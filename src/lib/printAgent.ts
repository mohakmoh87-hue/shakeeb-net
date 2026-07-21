// ===== عامل الطباعة الصامتة (يعمل على حاسبة المكتب ضمن worker.ts) =====
// يستطلع أوامر الطباعة (print_jobs) ويطبعها بصمت على الطابعة الافتراضية للحاسبة:
// HTML الوصل → PDF عبر puppeteer (متصفّح الواتساب المنصّب أصلاً) → طباعة صامتة
// عبر pdf-to-printer (SumatraPDF) بلا أي نافذة حوار.
// التوزيع: كل حاسبة تطبع أوامر مكاتبها (جلسة واتساب محلية)، والقائد يلتقط ما لم
// يلتقطه أحد خلال 15 ثانية (حالة الحاسبة الواحدة لوكيلٍ بعدّة مكاتب).
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { subscriptionReceiptHtml, invoiceReceiptHtml } from "@/lib/printReceiptHtml";

type Browser = { newPage: () => Promise<Page>; close: () => Promise<void> };
type Page = {
  setContent: (html: string, opts?: { waitUntil?: string }) => Promise<void>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  pdf: (opts: Record<string, unknown>) => Promise<Uint8Array>;
  close: () => Promise<void>;
};

// متصفّح واحد كسول يُعاد استخدامه (يُصفَّر عند الخطأ)
let browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  const puppeteer = (await import("puppeteer")).default as unknown as {
    launch: (o: Record<string, unknown>) => Promise<Browser>;
  };
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  return browser;
}

async function htmlToPdf(html: string): Promise<string> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    // ارتفاع الصفحة = طول المحتوى الفعلي (+2مم أماناً): تبدأ الطباعة من رأس الورقة
    // وتُقصّ بنهاية الكتابة — ورقة واحدة دائماً مهما طال الوصل أو قصُر.
    const px = await page.evaluate(() => document.documentElement.scrollHeight);
    const mm = Math.min(Math.max(Math.ceil(px * 25.4 / 96) + 2, 40), 500);
    const pdf = await page.pdf({
      width: "80mm",
      height: `${mm}mm`,
      printBackground: true,
      preferCSSPageSize: false,
      pageRanges: "1", // ضمانة صلبة: صفحة واحدة فقط مهما حدث
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const file = path.join(os.tmpdir(), `shakeeb-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(file, pdf);
    return file;
  } finally {
    await page.close().catch(() => {});
  }
}

// طباعة صامتة على الطابعة الافتراضية (بلا تحجيم — القياس مضبوط 80مم من المصدر)
async function printPdfSilently(file: string): Promise<void> {
  const { print } = (await import("pdf-to-printer")) as unknown as {
    print: (f: string, o?: Record<string, unknown>) => Promise<void>;
  };
  await print(file, { scale: "noscale" });
}

async function renderJobHtml(kind: string, refId: number, agentId: number | null): Promise<string | null> {
  if (kind === "subscription") return subscriptionReceiptHtml(refId, agentId);
  if (kind === "invoice") return invoiceReceiptHtml(refId, agentId);
  return null;
}

async function processJob(job: { id: number; kind: string; refId: number; agentId: number | null }): Promise<void> {
  // التقاط ذرّي: الفائز الوحيد يقلب pending → printing (يمنع طباعة مزدوجة بين حاسبتين)
  const claimed = await prisma.printJob.updateMany({
    where: { id: job.id, status: "pending" },
    data: { status: "printing" },
  });
  if (claimed.count === 0) return;
  let file: string | null = null;
  try {
    const html = await renderJobHtml(job.kind, job.refId, job.agentId);
    if (!html) throw new Error("الوصل غير موجود");
    file = await htmlToPdf(html);
    await printPdfSilently(file);
    await prisma.printJob.update({ where: { id: job.id }, data: { status: "done", doneAt: new Date(), error: null } });
    console.log(`[print] ✅ طُبع وصل ${job.kind}#${job.refId} (أمر ${job.id})`);
  } catch (e) {
    browser?.close().catch(() => {});
    browser = null; // صفّر المتصفّح احتياطاً — قد يكون سبب الفشل
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[print] ❌ فشل أمر ${job.id}:`, msg);
    await prisma.printJob.update({ where: { id: job.id }, data: { status: "failed", error: msg.slice(0, 800) } }).catch(() => {});
  } finally {
    if (file) fs.unlink(file, () => {});
  }
}

let lastCleanup = 0;

export function startPrintAgent() {
  const gg = globalThis as unknown as { __printAgentStarted?: boolean };
  if (gg.__printAgentStarted) return;
  gg.__printAgentStarted = true;
  console.log("[print] عامل الطباعة الصامتة يعمل — يطبع على الطابعة الافتراضية للحاسبة");

  setInterval(async () => {
    try {
      const { hostsOfficeLocally } = await import("@/lib/whatsapp");
      const { isLeaderNow, getWorkerAgentId } = await import("@/lib/hybridAgent");

      // أوامر آخر 10 دقائق فقط (الأقدم فاتت فائدتها — الوصل يُعاد طبعه بضغطة)
      const pend = await prisma.printJob.findMany({
        where: { status: "pending", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
        orderBy: { id: "asc" },
        take: 5,
      });
      if (pend.length === 0) return;

      const aid = getWorkerAgentId();
      // عزل طابعات المكاتب: حاسبة المكتب = مالكة جلسة واتسابه (wa_sessions.hostMachineId).
      // وصل مكتبٍ له مالكة مسجّلة يُطبع على حاسبتها حصراً — لا يلتقطه أحد غيرها أبداً
      // (يمنع طباعة وصل المواصلات على طابعة الرسالة). بلا مالكة مسجّلة: امتلاك مجلد
      // الجلسة، ثم القائد لليتيم بعد 15ث (حالة الحاسبة الواحدة لعدّة مكاتب).
      const mid = process.env.MACHINE_ID || null;
      const towerIds = [...new Set(pend.map((j) => j.towerId).filter((x): x is number => x != null))];
      const ownerOf = new Map<number, string | null>();
      if (towerIds.length) {
        const rows = await prisma.waSession.findMany({ where: { towerId: { in: towerIds } }, select: { towerId: true, hostMachineId: true } });
        for (const r of rows) ownerOf.set(r.towerId, r.hostMachineId ?? null);
      }
      for (const job of pend) {
        const owner = job.towerId != null ? ownerOf.get(job.towerId) ?? null : null;
        const mine = owner != null
          ? mid != null && owner === mid // ملكية صريحة ⇒ حاسبة المكتب حصراً
          : job.towerId != null && hostsOfficeLocally(job.towerId);
        const orphan = owner == null && isLeaderNow() && aid != null && job.agentId === aid &&
          Date.now() - job.createdAt.getTime() > 15_000;
        if (mine || orphan) await processJob(job);
      }

      // تنظيف دوري (كل ساعة): حذف أوامر الطباعة المنتهية الأقدم من 7 أيام — صيانة
      // طابور مؤقت خاص بالميزة، لا بيانات وكلاء.
      if (Date.now() - lastCleanup > 3600_000) {
        lastCleanup = Date.now();
        await prisma.printJob.deleteMany({
          where: { status: { in: ["done", "failed"] }, createdAt: { lt: new Date(Date.now() - 7 * 86400_000) } },
        }).catch(() => {});
      }
    } catch { /* دورة قادمة */ }
  }, 5000);
}
