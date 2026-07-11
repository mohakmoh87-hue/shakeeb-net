import Link from "next/link";

// ترويسة صفحة الوحدة: العنوان + زر رجوع + إجراء رئيسي
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
    <div className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm hover:bg-slate-100"
          title="الرئيسية"
        >
          ⌂
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
