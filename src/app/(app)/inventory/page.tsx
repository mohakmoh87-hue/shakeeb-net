"use client";

import CrudManager, { type Field } from "@/components/CrudManager";

type Item = {
  id: number;
  name: string | null;
  category: string | null;
  priceSale: number | null;
  priceSale2: number | null;
  priceDinar: number | null;
  count: number | null;
  barcode: string | null;
};

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

const fields: Field[] = [
  { name: "name", label: "اسم المادة", required: true },
  { name: "priceDinar", label: "سعر المادة (الكلفة)", type: "number" },
  { name: "count", label: "الكمية", type: "number" },
  { name: "priceSale", label: "سعر البيع", type: "number" },
  { name: "priceSale2", label: "سعر بيع خاص", type: "number" },
  { name: "category", label: "التصنيف" },
];

export default function InventoryPage() {
  return (
    <CrudManager<Item>
      title="المخزن"
      subtitle="المواد والكميات والأسعار"
      apiBase="/api/items"
      addLabel="إضافة مادة"
      fields={fields}
      columns={[
        { header: "#", render: (r) => r.id },
        { header: "الاسم", render: (r) => r.name },
        { header: "الكلفة", render: (r) => fmt(r.priceDinar) },
        { header: "سعر البيع", render: (r) => fmt(r.priceSale) },
        { header: "سعر خاص", render: (r) => fmt(r.priceSale2) },
        {
          header: "الكمية",
          render: (r) => (
            <span className={r.count != null && r.count <= 0 ? "font-bold text-red-600" : "text-slate-700"}>
              {fmt(r.count)}
            </span>
          ),
        },
      ]}
    />
  );
}
