import Link from "next/link";

// ترويسة صفحة الوحدة: شريط أنيق بستايل قريب من شريط الصفحة الرئيسية
// (تدرّج + شعار «نت» أزرق للرجوع + العنوان + الإجراء الرئيسي)
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-100 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          title="الصفحة الرئيسية"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mynet-blue text-base font-extrabold text-white shadow-md transition hover:brightness-110"
        >
          نت
        </Link>
        <div className="leading-tight">
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{title}</h1>
          {subtitle && <p className="text-xs font-medium text-slate-500 sm:text-sm">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
