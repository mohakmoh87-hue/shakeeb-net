"use client";

import { ReactNode } from "react";

// غلاف الجدول الموحّد للطراز الجديد (ب0 — لا يستعمله أحد بعد؛ تعتمده مراحل ب2..ب5):
// رأس لاصق + تمرير أفقي داخلي (الصفحة لا تمرّر أفقياً أبداً) + أرقام ثابتة العرض
// + صفوف قابلة للنقر + حالة فارغة موحّدة.
export default function DataTable({
  headers,
  rows,
  onRowClick,
  empty = "لا توجد بيانات",
  maxHeight,
  footer,
}: {
  headers: ReactNode[];
  rows: { key: string | number; cells: ReactNode[]; className?: string; active?: boolean }[];
  onRowClick?: (key: string | number) => void;
  empty?: string;
  maxHeight?: string; // مثال: "60vh" — يفعّل التمرير العمودي الداخلي مع الرأس اللاصق
  footer?: ReactNode; // شريط مجموع/خلاصة أسفل الجدول (اختياري)
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className="w-full text-right text-sm [&_td]:tabular-nums">
          <thead className="sticky top-0 z-10 bg-surface-2 text-ink-2">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap p-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="p-8 text-center text-muted">{empty}</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={onRowClick ? () => onRowClick(r.key) : undefined}
                  className={`border-t border-line ${onRowClick ? "cursor-pointer hover:bg-surface-2" : ""} ${r.active ? "bg-surface-2" : ""} ${r.className ?? ""}`}
                >
                  {r.cells.map((c, i) => (
                    <td key={i} className="p-2">{c}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-line bg-surface-2 px-3 py-2 text-sm font-bold text-ink">{footer}</div>}
    </div>
  );
}
