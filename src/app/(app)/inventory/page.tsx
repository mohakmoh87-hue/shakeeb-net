"use client";

import { useEffect, useState } from "react";
import CrudManager, { type Field } from "@/components/CrudManager";
import { usePermission } from "@/lib/usePermission";

type Item = {
  id: number;
  name: string | null;
  category: string | null;
  priceSale: number | null;
  priceSale2: number | null;
  priceDinar: number | null;
  count: number | null;
  barcode: string | null;
  towerId: number | null;
};
type Tower = { id: number; name: string | null };

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

export default function InventoryPage() {
  const { me } = usePermission();
  const [towers, setTowers] = useState<Tower[]>([]);
  useEffect(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setTowers)));
  }, []);
  const isAdmin = !!me?.isAdmin;
  const towerName = (id: number | null) => towers.find((t) => t.id === id)?.name ?? "—";

  // مخزن مستقل لكل مكتب: مستخدم المكتب يُنسب مخزنه تلقائياً؛ المدير يختار المكتب
  const fields: Field[] = [
    { name: "name", label: "اسم المادة", required: true },
    { name: "priceDinar", label: "سعر المادة (الكلفة)", type: "number" },
    { name: "count", label: "الكمية", type: "number" },
    { name: "priceSale", label: "سعر البيع", type: "number" },
    { name: "priceSale2", label: "سعر بيع خاص", type: "number" },
    { name: "category", label: "التصنيف" },
    ...(isAdmin
      ? ([{ name: "towerId", label: "المكتب", type: "select", required: true, options: towers.map((t) => ({ value: t.id, label: t.name ?? `#${t.id}` })) }] as Field[])
      : []),
  ];

  return (
    <CrudManager<Item>
      title="المخزن"
      subtitle="المواد والكميات والأسعار — مخزن مستقل لكل مكتب"
      apiBase="/api/items"
      addLabel="إضافة مادة"
      fields={fields}
      columns={[
        { header: "#", render: (r) => r.id },
        { header: "الاسم", render: (r) => r.name },
        ...(isAdmin ? [{ header: "المكتب", render: (r: Item) => towerName(r.towerId) }] : []),
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
