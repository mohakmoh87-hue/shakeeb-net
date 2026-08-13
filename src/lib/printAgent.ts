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
import { getReceiptTemplate } from "@/lib/receiptTemplate";

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
    // أبعاد الورقة تأتي من القالب موسومةً على <html> (data-paper-w/-h):
    //   • عرض الصفحة = عرض الورقة المختارة (٥٨/٧٦/٨٠مم حراريّة، أو A4/Letter).
    //   • paper-h > 0 (ورق مقصوص): الطول ثابت ⇒ صفحة كاملة والمحتوى أعلى-وسط.
    //   • paper-h = 0 (لفّة حراريّة): الطول = طول المحتوى (+2مم) فتُقصّ بنهاية الكتابة.
    const meta = await page.evaluate(() => ({
      w: Number(document.documentElement.getAttribute("data-paper-w")) || 80,
      h: Number(document.documentElement.getAttribute("data-paper-h")) || 0,
      px: document.documentElement.scrollHeight,
    }));
    const heightMm = meta.h > 0
      ? meta.h
      : Math.min(Math.max(Math.ceil(meta.px * 25.4 / 96) + 2, 40), 500);
    const pdf = await page.pdf({
      width: `${meta.w}mm`,
      height: `${heightMm}mm`,
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

// طباعة صامتة (بلا تحجيم — القياس مضبوط من المصدر). طابعة الوصل: الاسم المختار للمكتب
// إن وُجد، وإلا الطابعة الافتراضية للحاسبة (سلوك حالي محفوظ لمن لم يختر طابعة).
async function printPdfSilently(file: string, printerName?: string | null): Promise<void> {
  const { print } = (await import("pdf-to-printer")) as unknown as {
    print: (f: string, o?: Record<string, unknown>) => Promise<void>;
  };
  const opts: Record<string, unknown> = { scale: "noscale" };
  const name = (printerName ?? "").trim();
  if (name) opts.printer = name;
  await print(file, opts);
}

async function renderJobHtml(kind: string, refId: number, agentId: number | null, towerId: number | null): Promise<string | null> {
  if (kind === "subscription") return subscriptionReceiptHtml(refId, agentId);
  if (kind === "invoice") return invoiceReceiptHtml(refId, agentId);
  // «وصل مشترك» من صفحة كلّ المشتركين — refId = معرّف المشترك (وصلٌ لكلٍّ على حِدة)
  if (kind === "notice") {
    const { noticeSlipHtml } = await import("@/lib/printReceiptHtml");
    return noticeSlipHtml(refId, agentId, towerId);
  }
  // البند ٦ · «وصل تسديد الدين» — refId = **قيدُ الصندوق** لا المشترك (فيُعاد طبعُ
  // الوصل بعينه، ولا يُطبع «آخرُ تسديد» لمن سدّد مرّتَين في يوم)
  if (kind === "debt") {
    const { debtSlipHtml } = await import("@/lib/printReceiptHtml");
    return debtSlipHtml(refId, agentId, towerId);
  }
  return null;
}

async function processJob(job: { id: number; kind: string; refId: number; agentId: number | null; towerId: number | null }): Promise<void> {
  // التقاط ذرّي: الفائز الوحيد يقلب pending → printing (يمنع طباعة مزدوجة بين حاسبتين)
  const claimed = await prisma.printJob.updateMany({
    where: { id: job.id, status: "pending" },
    data: { status: "printing" },
  });
  if (claimed.count === 0) return;
  let file: string | null = null;
  try {
    const html = await renderJobHtml(job.kind, job.refId, job.agentId, job.towerId);
    if (!html) throw new Error("الوصل غير موجود");
    // طابعة الوصل من قالب **مكتب هذا الأمر نفسه** (عزل: agentId+towerId الخاصّان بالأمر
    // فقط)؛ فارغ ⇒ الطابعة الافتراضية للحاسبة. لا يُستعمل قالب مكتبٍ/وكيلٍ آخر أبداً.
    const tpl = await getReceiptTemplate(job.agentId, job.towerId);
    file = await htmlToPdf(html);
    await printPdfSilently(file, tpl.printerName);
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
let lastPendingCleanup = 0;

export function startPrintAgent() {
  const gg = globalThis as unknown as { __printAgentStarted?: boolean };
  if (gg.__printAgentStarted) return;
  gg.__printAgentStarted = true;
  console.log("[print] عامل الطباعة الصامتة يعمل — يطبع على الطابعة الافتراضية للحاسبة");

  setInterval(async () => {
    try {
      const { hostsOfficeLocally } = await import("@/lib/whatsapp");
      const { isLeaderNow, getWorkerAgentId } = await import("@/lib/hybridAgent");

      // تنظيف الأوامر المعلّقة الأقدم من 30 دقيقة (لم تُرسَل) — كل 5 دقائق، ولمكاتب
      // **وكيل هذه الحاسبة حصراً** (عزل: agentId العامل). يمنع تراكم أوامر عالقة (مثل مكتب
      // بلا طابعة صحيحة) ويمنع طبعها دفعةً عند الإصلاح لاحقاً. يعمل قبل جلب الطابور كي
      // يُنظَّف حتى لو لم تُوجد أوامر حديثة.
      const cleanupAid = getWorkerAgentId();
      if (cleanupAid != null && Date.now() - lastPendingCleanup > 5 * 60_000) {
        lastPendingCleanup = Date.now();
        await prisma.printJob.deleteMany({
          where: { agentId: cleanupAid, status: "pending", createdAt: { lt: new Date(Date.now() - 30 * 60_000) } },
        }).catch(() => {});
      }

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
