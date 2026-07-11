import Link from "next/link";

// بطاقة وحدة (Tile) بنمط البرنامج الأصلي
export default function ModuleTile({
  label,
  icon,
  href,
  color = "#1c8fe6",
  enabled = false,
}: {
  label: string;
  icon: string;
  href?: string;
  color?: string;
  enabled?: boolean;
}) {
  const inner = (
    <div
      className={`mynet-tile flex h-32 flex-col items-center justify-center gap-3 rounded-xl border bg-white text-center shadow-lg ${
        enabled
          ? "border-slate-200 hover:shadow-xl"
          : "border-slate-200/60 opacity-60"
      }`}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-2xl"
        style={{
          backgroundColor: enabled ? `${color}1a` : "#f1f5f9",
          color: enabled ? color : "#94a3b8",
        }}
      >
        {icon}
      </div>
      <span
        className={`text-base font-bold ${
          enabled ? "text-slate-800" : "text-slate-400"
        }`}
      >
        {label}
      </span>
      {!enabled && (
        <span className="text-[10px] text-slate-400">قريباً</span>
      )}
    </div>
  );

  if (enabled && href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return <div title="سيُفعَّل في مرحلة قادمة">{inner}</div>;
}
