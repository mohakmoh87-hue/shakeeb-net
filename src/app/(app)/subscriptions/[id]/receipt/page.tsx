import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrintButton from "@/components/PrintButton";
import ReceiptPrintStyle from "@/components/ReceiptPrintStyle";
import AutoPrint from "@/components/AutoPrint";
import { getReceiptTemplate } from "@/lib/receiptTemplate";
import { getSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";

const fmt = (n: number | null | undefined) =>
  n == null ? "0" : Number(n).toLocaleString("en-US");
const fmtDate = (d: Date | null) => formatDate(d);

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await prisma.subscriptionEntry.findUnique({
    where: { id: Number(id) },
  });
  if (!entry) notFound();

  const subscriber = entry.subscriberId
    ? await prisma.subscriber.findUnique({ where: { id: entry.subscriberId } })
    : null;

  // اسم العلامة من الوكيل الحالي، ثم الإعداد العام، ثم الافتراضي
  const session = await getSession();
  const agent = session?.agentId != null
    ? await prisma.agent.findUnique({ where: { id: session.agentId }, select: { name: true } })
    : null;
  const officeSetting = await prisma.systemSetting.findFirst({ where: { type: "office" } });
  const officeName = agent?.name || officeSetting?.value || "SHAKEEB";
  const tpl = await getReceiptTemplate(session?.agentId ?? null);

  return (
    <div className="receipt-page flex min-h-[calc(100vh-140px)] items-start justify-center bg-slate-100 p-6">
      <ReceiptPrintStyle />
      <AutoPrint />
      <div className="w-full max-w-sm">
        {/* أزرار التحكم (تختفي عند الطباعة) */}
        <div className="no-print mb-4 flex justify-between">
          <a
            href="/subscriptions"
            className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-300"
          >
            ← رجوع
          </a>
          <PrintButton />
        </div>

        {/* الوصل — بألوان وترويسة قالب الوصل القابل للتخصيص */}
        <div
          className="print-area rounded-xl p-6 shadow-lg"
          style={{ backgroundColor: tpl.bgColor, color: tpl.fontColor, fontSize: `${tpl.fontSize}px` }}
        >
          <div className="mb-4 border-b-2 border-dashed border-slate-300 pb-3 text-center">
            {tpl.showLogo && (
              tpl.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tpl.logo} alt="شعار" className="mx-auto mb-2 h-14 object-contain" />
              ) : (
                <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold text-white" style={{ backgroundColor: tpl.headerColor }}>
                  نت
                </div>
              )
            )}
            <h1 className="text-xl font-bold" style={{ color: tpl.headerColor }}>{tpl.headerText || officeName}</h1>
            <p className="text-sm text-slate-500">وصل تفعيل / تجديد اشتراك</p>
          </div>

          <div className="space-y-2 text-sm">
            <Line label="رقم الوصل" value={`#${entry.id}`} />
            <Line label="التاريخ" value={fmtDate(entry.date)} />
            <Line label="المشترك" value={subscriber?.name ?? "—"} />
            {subscriber?.phone && (
              <Line label="الهاتف" value={subscriber.phone} />
            )}
            <Line label="الباقة" value={entry.cardType ?? "—"} />
            <Line label="عدد الأشهر" value={entry.month ?? "—"} />
            <div className="my-2 border-t border-dashed border-slate-200" />
            <Line label="من تاريخ" value={fmtDate(entry.dateFrom)} />
            <Line label="إلى تاريخ" value={fmtDate(entry.dateTo)} bold />
            <div className="my-2 border-t border-dashed border-slate-200" />
            <Line label="قيمة الاشتراك" value={`${fmt(entry.money)} د.ع`} />
            <Line
              label="المبلغ الواصل"
              value={`${fmt(entry.moneyIn)} د.ع`}
              color="text-emerald-600"
            />
            <Line
              label="الدين المتبقّي"
              value={`${fmt(entry.moneyCarry)} د.ع`}
              color="text-red-600"
              bold
            />
          </div>

          {entry.notes && (
            <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">
              ملاحظات: {entry.notes}
            </p>
          )}

          <div className="mt-5 border-t-2 border-dashed border-slate-300 pt-3 text-center text-xs text-slate-400">
            {tpl.footerText || "شكراً لاشتراككم"} — {officeName}
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`${bold ? "font-bold" : ""} ${color ?? "text-slate-800"}`}>
        {value}
      </span>
    </div>
  );
}
