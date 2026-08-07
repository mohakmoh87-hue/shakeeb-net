// مولّد HTML الوصل للطباعة الصامتة (العامل المحلي): مستند مكتفٍ ذاتياً يطابق تخطيط
// صفحتَي الوصل (اشتراك/فاتورة) وهندسة ReceiptPrintStyle: عرض الورقة يدويّ والكتابة موسَّطة.
// يُحوَّل إلى PDF عبر puppeteer ثم يُطبع بصمت على الطابعة الافتراضية.
import { prisma } from "@/lib/prisma";
import { getReceiptTemplate, type ReceiptTemplate } from "@/lib/receiptTemplate";
import { resolveDims, type PaperDims, type ReceiptBodyKey } from "@/lib/receiptPaper";
import { formatDate } from "@/lib/format";

const fmt = (n: number | null | undefined) => (n == null ? "0" : Number(n).toLocaleString("en-US"));
const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// غلاف المستند: أبعاد الورقة اليدويّة (resolveDims). عرض الصفحة = عرض الورقة، وصندوق الكتابة
// موسَّطٌ (margin:auto) ⇒ يُطبع وسط الورقة أيّاً كان عرضها. الأبعاد تُوسَم على <html>
// (data-paper-w/-h) ليقرأها printAgent فيولّد PDF بمقاسها (0 = لفّة، الطول من المحتوى).
function wrap(body: string, fontSize: number, g: PaperDims): string {
  const sheet = g.paperH > 0; // ورق مقصوص بطولٍ ثابت مقابل لفّة حراريّة
  return `<!doctype html><html dir="rtl" data-paper-w="${g.paperW}" data-paper-h="${g.paperH}"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { margin: 0; }
  html, body { width: ${g.paperW}mm; ${sheet ? `min-height: ${g.paperH}mm;` : ""} background: #fff; color: #000; font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
  /* كل النص أسود خالص وعريض (بولد) — طلب صريح لوضوح الطباعة الحرارية */
  .print-area { width: ${g.contentW}mm; max-width: ${g.contentW}mm; margin: 0 auto; padding: 1mm ${g.padX}mm 2mm; font-size: ${fontSize}px;
                font-weight: 700; color: #000; }
  .print-area * { color: #000 !important; border-color: #000 !important; background: transparent !important;
                  font-weight: 700 !important; opacity: 1 !important;
                  max-width: 100%; overflow-wrap: break-word; word-break: break-word; }
  .hdr h1, .b, .line .b, thead th { font-weight: 800 !important; }
  .hdr { text-align: center; border-bottom: 2px dashed #999; padding-bottom: 5px; margin-bottom: 6px; }
  .hdr h1 { font-size: 1.25em; font-weight: 800; }
  .hdr p { font-size: 0.85em; }
  .hdr img { max-height: 44px; margin: 0 auto 4px; display: block; }
  .line { display: flex; justify-content: space-between; align-items: center; padding: 1px 0; }
  .line .lbl { opacity: 0.75; }
  .b { font-weight: 700; }
  .sep { border-top: 1px dashed #bbb; margin: 4px 0; }
  .notes { margin-top: 6px; font-size: 0.85em; border: 1px solid #ccc; border-radius: 4px; padding: 4px; }
  .ftr { margin-top: 7px; border-top: 2px dashed #999; padding-top: 5px; text-align: center; font-size: 0.8em; }
  table { width: 100%; text-align: right; border-collapse: collapse; font-size: 0.95em; }
  th, td { padding: 3px 4px; border-bottom: 1px solid #ddd; }
  thead th { border-bottom: 1px solid #888; font-weight: 700; }
</style></head><body><div class="print-area">${body}</div></body></html>`;
}

function line(label: string, value: string, bold = false): string {
  return `<div class="line"><span class="lbl">${esc(label)}</span><span${bold ? ' class="b"' : ""}>${esc(value)}</span></div>`;
}

// اسم العلامة: اسم الوكيل ثم إعداد الوكيل «office» (معزول) ثم الافتراضي
async function brandName(agentId: number | null): Promise<string> {
  const agent = agentId != null
    ? await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } })
    : null;
  if (agent?.name) return agent.name;
  const { getAgentSetting } = await import("@/lib/agentSettings");
  return getAgentSetting("office", agentId, "SHAKEEB");
}

// الترويسة: الشعار (إن فُعِّل) + اسم المكتب دائماً + سطرٌ فرعيّ (إن فُعِّل حقل subtitle)
function header(tpl: { showLogo: boolean; logo: string; headerText: string }, officeName: string, subtitle: string, showSubtitle: boolean): string {
  const logo = tpl.showLogo && tpl.logo ? `<img src="${esc(tpl.logo)}" alt="">` : "";
  const sub = showSubtitle ? `<p>${esc(subtitle)}</p>` : "";
  return `<div class="hdr">${logo}<h1>${esc(tpl.headerText || officeName)}</h1>${sub}</div>`;
}

// وصل تفعيل/تجديد اشتراك — يطابق صفحة /subscriptions/[id]/receipt
export async function subscriptionReceiptHtml(entryId: number, agentId: number | null): Promise<string | null> {
  const entry = await prisma.subscriptionEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  const subscriber = entry.subscriberId
    ? await prisma.subscriber.findUnique({ where: { id: entry.subscriberId } })
    : null;
  const officeName = await brandName(agentId);
  // قالب مكتب الوصل المخصّص إن وُجد، وإلا قالب الوكيل العام
  const tpl = await getReceiptTemplate(agentId, entry.towerId);
  const F = tpl.fields;

  // صفٌّ واحد حسب مفتاحه — تُبنى الصفوف بترتيب tpl.fieldOrder، وتُعرَض إن كان حقلها ظاهراً
  const bodyRow = (key: ReceiptBodyKey): string => {
    switch (key) {
      case "receiptNo": return line("رقم الوصل", `#${entry.id}`);
      case "date": return line("التاريخ", formatDate(entry.date));
      case "subscriber": return line("المشترك", subscriber?.name ?? "—");
      case "phone": return subscriber?.phone ? line("الهاتف", subscriber.phone) : "";
      case "package": return line("الباقة", entry.cardType ?? "—");
      case "months": return line("عدد الأشهر", entry.month ?? "—");
      case "dateFrom": return line("من تاريخ", formatDate(entry.dateFrom));
      case "dateTo": return line("إلى تاريخ", formatDate(entry.dateTo), true);
      case "price": return line("قيمة الاشتراك", `${fmt(entry.money)} د.ع`);
      case "moneyIn": return line("المبلغ الواصل", `${fmt(entry.moneyIn)} د.ع`);
      case "moneyCarry": return line("الدين المتبقّي", `${fmt(entry.moneyCarry)} د.ع`, true);
      case "notes": return entry.notes ? `<div class="notes">ملاحظات: ${esc(entry.notes)}</div>` : "";
      default: return "";
    }
  };
  const rows = tpl.fieldOrder.filter((k) => F[k] !== false).map(bodyRow).join("");

  const footer = F.footer ? `<div class="ftr">${esc(tpl.footerText || "شكراً لاشتراككم")} — ${esc(officeName)}</div>` : "";
  const body = header(tpl, officeName, "وصل تفعيل / تجديد اشتراك", F.subtitle !== false) + rows + footer;
  return wrap(body, tpl.fontSize, resolveDims(tpl as ReceiptTemplate));
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
  // قالب مكتب الفاتورة المخصّص إن وُجد، وإلا قالب الوكيل العام
  const tpl = await getReceiptTemplate(agentId, invoice.towerId);
  const F = tpl.fields;

  const tableRows = lines.map((l) =>
    `<tr><td>${esc(l.itemId ? nameMap.get(l.itemId) ?? "—" : "—")}</td><td>${fmt(l.count)}</td><td>${fmt(l.price)}</td><td class="b">${fmt((l.count ?? 0) * (l.price ?? 0))}</td></tr>`,
  ).join("");

  const footer = F.footer ? `<div class="ftr">${esc(tpl.footerText || "شكراً لتعاملكم")} — ${esc(officeName)}</div>` : "";
  const body =
    header(tpl, officeName, "فاتورة بيع", F.subtitle !== false) +
    `<div class="line"><span>رقم الفاتورة: <b>#${invoice.number ?? invoice.id}</b></span><span>${esc(formatDate(invoice.date))}</span></div>` +
    `<table><thead><tr><th>المادة</th><th>كمية</th><th>سعر</th><th>مجموع</th></tr></thead><tbody>${tableRows}</tbody></table>` +
    `<div class="sep"></div>` +
    line("الإجمالي", `${fmt(invoice.totalMy)} د.ع`, true) +
    line("المدفوع", `${fmt(invoice.waselHim)} د.ع`) +
    line("المتبقّي", `${fmt((invoice.totalMy ?? 0) - (invoice.waselHim ?? 0))} د.ع`, true) +
    (invoice.note ? `<div class="notes">ملاحظات: ${esc(invoice.note)}</div>` : "") +
    footer;
  return wrap(body, tpl.fontSize, resolveDims(tpl as ReceiptTemplate));
}
