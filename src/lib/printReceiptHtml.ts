// مولّد HTML الوصل للطباعة الصامتة (العامل المحلي): مستند مكتفٍ ذاتياً يطابق تخطيط
// صفحتَي الوصل (اشتراك/فاتورة) وهندسة ReceiptPrintStyle: ورقة 80مم، كتابة 68مم موسَّطة.
// يُحوَّل إلى PDF عبر puppeteer ثم يُطبع بصمت على الطابعة الافتراضية.
import { prisma } from "@/lib/prisma";
import { getReceiptTemplate } from "@/lib/receiptTemplate";
import { formatDate } from "@/lib/format";

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// غلاف المستند: نفس هندسة ReceiptPrintStyle (@page 80×120مم، كتابة 68مم موسَّطة، أبيض/أسود)
function wrap(body: string, fontSize: number): string {
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 80mm 120mm; margin: 0; }
  html, body { width: 80mm; background: #fff; color: #000; font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
  .print-area { width: 68mm; max-width: 68mm; margin: 0 auto; padding: 3mm 4mm; font-size: ${fontSize}px; }
  .print-area * { color: #000 !important; border-color: #000 !important; background: transparent !important;
                  max-width: 100%; overflow-wrap: break-word; word-break: break-word; }
  .hdr { text-align: center; border-bottom: 2px dashed #999; padding-bottom: 8px; margin-bottom: 10px; }
  .hdr h1 { font-size: 1.25em; font-weight: 800; }
  .hdr p { font-size: 0.85em; }
  .hdr img { max-height: 48px; margin: 0 auto 6px; display: block; }
  .line { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; }
  .line .lbl { opacity: 0.75; }
  .b { font-weight: 700; }
  .sep { border-top: 1px dashed #bbb; margin: 6px 0; }
  .notes { margin-top: 8px; font-size: 0.85em; border: 1px solid #ccc; border-radius: 4px; padding: 5px; }
  .ftr { margin-top: 12px; border-top: 2px dashed #999; padding-top: 8px; text-align: center; font-size: 0.8em; }
  table { width: 100%; text-align: right; border-collapse: collapse; font-size: 0.95em; }
  th, td { padding: 3px 4px; border-bottom: 1px solid #ddd; }
  thead th { border-bottom: 1px solid #888; font-weight: 700; }
</style></head><body><div class="print-area">${body}</div></body></html>`;
}

function line(label: string, value: string, bold = false): string {
  return `<div class="line"><span class="lbl">${esc(label)}</span><span${bold ? ' class="b"' : ""}>${esc(value)}</span></div>`;
}

// اسم العلامة: اسم الوكيل ثم الإعداد العام ثم الافتراضي (نفس منطق صفحات الوصل)
async function brandName(agentId: number | null): Promise<string> {
  const agent = agentId != null
    ? await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } })
    : null;
  const officeSetting = await prisma.systemSetting.findFirst({ where: { type: "office" } });
  return agent?.name || officeSetting?.value || "SHAKEEB";
}

function header(tpl: { showLogo: boolean; logo: string; headerText: string }, officeName: string, subtitle: string): string {
  const logo = tpl.showLogo && tpl.logo ? `<img src="${esc(tpl.logo)}" alt="">` : "";
  return `<div class="hdr">${logo}<h1>${esc(tpl.headerText || officeName)}</h1><p>${esc(subtitle)}</p></div>`;
}

// وصل تفعيل/تجديد اشتراك — يطابق صفحة /subscriptions/[id]/receipt
export async function subscriptionReceiptHtml(entryId: number, agentId: number | null): Promise<string | null> {
  const entry = await prisma.subscriptionEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  const subscriber = entry.subscriberId
    ? await prisma.subscriber.findUnique({ where: { id: entry.subscriberId } })
    : null;
  const officeName = await brandName(agentId);
  const tpl = await getReceiptTemplate(agentId);

  const rows = [
    line("رقم الوصل", `#${entry.id}`),
    line("التاريخ", formatDate(entry.date)),
    line("المشترك", subscriber?.name ?? "—"),
    subscriber?.phone ? line("الهاتف", subscriber.phone) : "",
    line("الباقة", entry.cardType ?? "—"),
    line("عدد الأشهر", entry.month ?? "—"),
    `<div class="sep"></div>`,
    line("من تاريخ", formatDate(entry.dateFrom)),
    line("إلى تاريخ", formatDate(entry.dateTo), true),
    `<div class="sep"></div>`,
    line("قيمة الاشتراك", `${fmt(entry.money)} د.ع`),
    line("المبلغ الواصل", `${fmt(entry.moneyIn)} د.ع`),
    line("الدين المتبقّي", `${fmt(entry.moneyCarry)} د.ع`, true),
  ].join("");

  const notes = entry.notes ? `<div class="notes">ملاحظات: ${esc(entry.notes)}</div>` : "";
  const body =
    header(tpl, officeName, "وصل تفعيل / تجديد اشتراك") + rows + notes +
    `<div class="ftr">${esc(tpl.footerText || "شكراً لاشتراككم")} — ${esc(officeName)}</div>`;
  return wrap(body, tpl.fontSize);
}

// وصل فاتورة بيع — يطابق صفحة /invoices/[id]/receipt
export async function invoiceReceiptHtml(invoiceId: number, agentId: number | null): Promise<string | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;
  const lines = await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id, isDeleted: false } });
  const itemIds = lines.map((l) => l.itemId).filter(Boolean) as number[];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } });
  const nameMap = new Map(items.map((i) => [i.id, i.name]));
  const officeName = await brandName(agentId);
  const tpl = await getReceiptTemplate(agentId);

  const tableRows = lines.map((l) =>
    `<tr><td>${esc(l.itemId ? nameMap.get(l.itemId) ?? "—" : "—")}</td><td>${fmt(l.count)}</td><td>${fmt(l.price)}</td><td class="b">${fmt((l.count ?? 0) * (l.price ?? 0))}</td></tr>`,
  ).join("");

  const body =
    header(tpl, officeName, "فاتورة بيع") +
    `<div class="line"><span>رقم الفاتورة: <b>#${invoice.number ?? invoice.id}</b></span><span>${esc(formatDate(invoice.date))}</span></div>` +
    `<table><thead><tr><th>المادة</th><th>كمية</th><th>سعر</th><th>مجموع</th></tr></thead><tbody>${tableRows}</tbody></table>` +
    `<div class="sep"></div>` +
    line("الإجمالي", `${fmt(invoice.totalMy)} د.ع`, true) +
    line("المدفوع", `${fmt(invoice.waselHim)} د.ع`) +
    line("المتبقّي", `${fmt((invoice.totalMy ?? 0) - (invoice.waselHim ?? 0))} د.ع`, true) +
    (invoice.note ? `<div class="notes">ملاحظات: ${esc(invoice.note)}</div>` : "") +
    `<div class="ftr">${esc(tpl.footerText || "شكراً لتعاملكم")} — ${esc(officeName)}</div>`;
  return wrap(body, tpl.fontSize);
}
