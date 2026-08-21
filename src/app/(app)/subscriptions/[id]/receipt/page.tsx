import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrintButton from "@/components/PrintButton";
import ReceiptPrintStyle from "@/components/ReceiptPrintStyle";
import SilentPrint from "@/components/SilentPrint";
import { getReceiptTemplate } from "@/lib/receiptTemplate";
import { getSession } from "@/lib/auth";
import { formatDate, formatExpiry } from "@/lib/format";

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

  const session = await getSession();
  // عزل الوكلاء (IDOR): الوصل يُعرض لمن يملك مكتبه فقط — كان يُفتح بالمعرّف لأي مستخدم مسجّل
  const { ownsTower } = await import("@/lib/guard");
  const entryTower = entry.towerId ?? subscriber?.towerId ?? null;
  if (!session || !(await ownsTower(session, entryTower))) notFound();
  const agent = session?.agentId != null
    ? await prisma.agent.findUnique({ where: { id: session.agentId }, select: { name: true } })
    : null;
  // اسم النظام الافتراضي من إعدادات وكيل الجلسة حصراً (عزل الوكلاء)
  const { getAgentSetting } = await import("@/lib/agentSettings");
  const officeName = agent?.name || (await getAgentSetting("office", session?.agentId, "SHAKEEB"));
  // قالب مكتب الوصل المخصّص إن وُجد، وإلا قالب الوكيل العام
  const tpl = await getReceiptTemplate(session?.agentId ?? null, entryTower);

  return (
    <div className="receipt-page flex min-h-[calc(100vh-140px)] items-start justify-center bg-slate-100 p-6">
      <ReceiptPrintStyle paperW={tpl.paperW} paperH={tpl.paperH} contentW={tpl.contentW} />
      <div className="w-full max-w-sm">
        <SilentPrint kind="subscription" id={entry.id} />
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
            {tpl.fields.subtitle !== false && (
              <p className="text-sm text-slate-500">وصل تفعيل / تجديد اشتراك</p>
            )}
          </div>

          {/* الصفوف حسب ترتيب القالب (fieldOrder) وإظهاره (fields) — يطابق الطباعة الصامتة */}
          <div className="space-y-2 text-sm">
            {tpl.fieldOrder.filter((k) => tpl.fields[k] !== false).map((key) => {
              switch (key) {
                case "receiptNo": return <Line key={key} label="رقم الوصل" value={`#${entry.id}`} />;
                case "date": return <Line key={key} label="التاريخ" value={fmtDate(entry.date)} />;
                case "subscriber": return <Line key={key} label="المشترك" value={subscriber?.name ?? "—"} />;
                case "phone": return subscriber?.phone ? <Line key={key} label="الهاتف" value={subscriber.phone} /> : null;
                case "package": return <Line key={key} label="الباقة" value={entry.cardType ?? "—"} />;
                case "months": return <Line key={key} label="عدد الأشهر" value={entry.month ?? "—"} />;
                case "dateFrom": return <Line key={key} label="من تاريخ" value={fmtDate(entry.dateFrom)} />;
                case "dateTo": return <Line key={key} label="إلى تاريخ" value={formatExpiry(entry.dateTo)} bold />;
                case "price": return <Line key={key} label="قيمة الاشتراك" value={`${fmt(entry.money)} د.ع`} />;
                case "moneyIn": return <Line key={key} label="المبلغ الواصل" value={`${fmt(entry.moneyIn)} د.ع`} color="text-emerald-600" />;
                case "moneyCarry": return <Line key={key} label="الدين المتبقّي" value={`${fmt(entry.moneyCarry)} د.ع`} color="text-red-600" bold />;
                case "notes": return entry.notes ? <p key={key} className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600">ملاحظات: {entry.notes}</p> : null;
                default: return null;
              }
            })}
          </div>

          {tpl.fields.footer !== false && (
            <div className="mt-5 border-t-2 border-dashed border-slate-300 pt-3 text-center text-xs text-slate-400">
              {/* اسم المكتب مُطفأٌ افتراضيّاً (officeInFooter)، وعنوان المكتب سطرٌ أسفل الهاتف */}
              {tpl.footerText || "شكراً لاشتراككم"}{tpl.fields.officeInFooter === true ? ` — ${officeName}` : ""}
              {/* العنوانُ متعدّدُ الأسطر (طلبُ محمد) — `whitespace-pre-line` يُنزّل الأسطرَ كما كُتبت */}
              {tpl.addressText && <div className="whitespace-pre-line">{tpl.addressText}</div>}
            </div>
          )}
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
