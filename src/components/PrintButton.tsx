"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white shadow hover:bg-mynet-blue-dark"
    >
      🖨️ طباعة الوصل
    </button>
  );
}
