"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as LeafletNS from "leaflet";

export type TrackPoint = { id: number; name: string; lat: number; lng: number; fresh: boolean; pole?: string | null; poleDistM?: number | null; at?: string | null };

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

// آخر ظهور بصيغة تراكمية: ثوانٍ ثم دقائق، وتُضاف الساعة بعد 60 دقيقة، واليوم بعد 24 ساعة.
export function fmtAgo(at: string | null | undefined): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  if (s < 60) return `قبل ${s} ث`;
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return `قبل ${h} س${mm ? ` ${mm} د` : ""}`;
  const d = Math.floor(h / 24), hh = h % 24;
  return `قبل ${d} ي${hh ? ` ${hh} س` : ""}`;
}

// خريطة Leaflet (OpenStreetMap) تعرض عدّة فنيين، كلٌّ بمؤشّر فوقه اسمه.
// عميل فقط (يستعمل window). CSP يسمح ببلاطات OSM (لا قيود img/connect).
export default function TrackMap({ points, className }: { points: TrackPoint[]; className?: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const LRef = useRef<typeof LeafletNS | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  function render() {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const p of pointsRef.current) {
      // أقرب عامود اشتراكات + مسافته بالمتر: نصٌّ بجانب الاسم فقط (لا مؤشّر له على الخريطة)
      const distHtml = p.pole && p.poleDistM != null ? `<span class="tm-dist">${p.poleDistM}م</span>` : "";
      const poleHtml = p.pole ? `<span class="tm-pole" dir="ltr">${escapeHtml(p.pole)}</span>${distHtml}` : "";
      const agoTxt = fmtAgo(p.at);
      const agoHtml = agoTxt ? `<span class="tm-ago">🕒 ${escapeHtml(agoTxt)}</span>` : "";
      const icon = L.divIcon({
        className: "",
        html: `<div class="tm-pin ${p.fresh ? "tm-fresh" : "tm-stale"}"><span class="tm-name">${escapeHtml(p.name)}${poleHtml}${agoHtml}</span><span class="tm-dot"></span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([p.lat, p.lng], { icon }).addTo(layer);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [55, 55], maxZoom: 16 });
  }

  // تهيئة الخريطة مرّة واحدة
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !elRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(elRef.current, { zoomControl: true, attributionControl: false }).setView([33.315, 44.366], 11); // بغداد افتراضياً
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => { map.invalidateSize(); render(); }, 60);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; }
    };
  }, []);

  // إعادة رسم المؤشّرات عند تغيّر المواقع
  useEffect(() => { render(); }, [points]);

  return <div ref={elRef} className={className} />;
}
