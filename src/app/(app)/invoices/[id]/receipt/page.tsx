import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrintButton from "@/components/PrintButton";
import ReceiptPrintStyle from "@/components/ReceiptPrintStyle";
import { getReceiptTemplate } from "@/lib/receiptTemplate";
import { getSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";

const fmt = (n: number | null | undefined) =>
  n == null ? "0" : Number(n).toLocaleString("en-US");
const fmtDate = (d: Date | null) => formatDate(d);

export default async function InvoiceReceipt({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id: Number(id) } });
  if (!invoice) notFound();

  const lines = await prisma.invoiceItem.findMany({
    where: { invoiceId: invoice.id, isDeleted: false },
  });
  const itemIds = lines.map((l) => l.itemId).filter(Boolean) as number[];
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(items.map((i) => [i.id, i.name]));

  const session = await getSession();
  const agent = session?.agentId != null
    ? await prisma.agent.findUnique({ where: { id: session.agentId }, select: { name: true } })
    : null;
  const officeSetting = await prisma.systemSetting.findFirst({ where: { type: "office" } });
  const officeName = agent?.name || officeSetting?.value || "شكيب نت للانترنت";
  const tpl = await getReceiptTemplate(session?.agentId ?? null);

  return (
    <div className="receipt-page flex min-h-[calc(100vh-140px)] items-start justify-center bg-slate-100 p-6">
      <ReceiptPrintStyle />
      <div className="w-full max-w-md">
        <div className="no-print mb-4 flex justify-between">
          <a href="/invoices" className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-300">
            ← فاتورة جديدة
          </a>
          <PrintButton />
        </div>

        <div className="print-area rounded-xl p-6 shadow-lg" style={{ backgroundColor: tpl.bgColor, color: tpl.fontColor, fontSize: `${tpl.fontSize}px` }}>
          <div className="mb-4 border-b-2 border-dashed border-slate-300 pb-3 text-center">
            {tpl.showLogo && tpl.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tpl.logo} alt="شعار" className="mx-auto mb-2 h-14 object-contain" />
            )}
            <h1 className="text-xl font-bold" style={{ color: tpl.headerColor }}>{tpl.headerText || officeName}</h1>
            <p className="text-sm text-slate-500">فاتورة بيع</p>
          </div>

          <div className="mb-3 flex justify-between text-sm">
            <span>رقم الفاتورة: <b>#{invoice.number}</b></span>
            <span>{fmtDate(invoice.date)}</span>
          </div>

          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-slate-500">
                <th className="p-2">المادة</th>
                <th className="p-2">كمية</th>
                <th className="p-2">سعر</th>
                <th className="p-2">مجموع</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="p-2">{l.itemId ? nameMap.get(l.itemId) ?? "—" : "—"}</td>
                  <td className="p-2">{fmt(l.count)}</td>
                  <td className="p-2">{fmt(l.price)}</td>
                  <td className="p-2 font-semibold">{fmt((l.count ?? 0) * (l.price ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 space-y-1 border-t-2 border-dashed border-slate-300 pt-3 text-sm">
            <div className="flex justify-between text-lg font-bold">
              <span>الإجمالي</span>
              <span className="text-mynet-blue">{fmt(invoice.totalMy)} د.ع</span>
            </div>
            <div className="flex justify-between text-emerald-600">
              <span>المدفوع</span>
              <span>{fmt(invoice.waselHim)} د.ع</span>
            </div>
            <div className="flex justify-between text-red-600">
              <span>المتبقّي</span>
              <span>{fmt((invoice.totalMy ?? 0) - (invoice.waselHim ?? 0))} د.ع</span>
            </div>
          </div>

          {invoice.note && (
            <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">ملاحظات: {invoice.note}</p>
          )}
          <div className="mt-5 border-t-2 border-dashed border-slate-300 pt-3 text-center text-xs text-slate-400">
            {tpl.footerText || "شكراً لتعاملكم"} — {officeName}
          </div>
        </div>
      </div>
    </div>
  );
}
