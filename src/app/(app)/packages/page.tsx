"use client";

import { useEffect, useState } from "react";
import CrudManager, { type Field } from "@/components/CrudManager";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type Pkg = {
  id: number;
  name: string | null;
  priceDollar: number | null;
  priceDinar: number | null;
  addPrice: number | null;
  towerId: number | null;
};
type Tower = { id: number; name: string | null };

export default function PackagesPage() {
  const { can, me } = usePermission();
  const [towers, setTowers] = useState<Tower[]>([]);

  useEffect(() => {
    fetch("/api/towers")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTowers);
  }, []);

  const towerName = (id: number | null) =>
    towers.find((t) => t.id === id)?.name ?? "—";

  const fields: Field[] = [
    { name: "name", label: "اسم الباقة", required: true },
    { name: "priceDollar", label: "السعر بالدولار", type: "number" },
    { name: "priceDinar", label: "السعر بالدينار", type: "number" },
    { name: "addPrice", label: "سعر الإضافة", type: "number" },
    {
      name: "towerId",
      label: "المكتب",
      type: "select",
      options: towers.map((t) => ({ value: t.id, label: t.name ?? `#${t.id}` })),
    },
  ];

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("packages.manage")) {
    return <div className="p-6"><PageHeader title="الباقات" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إدارة الباقات.</div></div>;
  }

  return (
    <CrudManager<Pkg>
      title="الباقات"
      subtitle="باقات الاشتراك وأسعارها بالدولار والدينار"
      apiBase="/api/packages"
      addLabel="إضافة باقة"
      fields={fields}
      columns={[
        { header: "#", render: (r) => r.id },
        { header: "الاسم", render: (r) => r.name },
        {
          header: "دولار",
          render: (r) =>
            r.priceDollar != null ? `$${r.priceDollar}` : "—",
        },
        {
          header: "دينار",
          render: (r) =>
            r.priceDinar != null ? r.priceDinar.toLocaleString() : "—",
        },
        { header: "المكتب", render: (r) => towerName(r.towerId) },
      ]}
    />
  );
}
