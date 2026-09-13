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

export type TrackStopMarker = { lat: number; lng: number; minutes: number; startedAt?: string | null; endedAt?: string | null; pole?: string | null; poleDistM?: number | null };

// وقت بغداد HH:MM من ISO (لعرض أوقات التوقّفات في السجلّ)
export function fmtClock(at: string | null | undefined): string {
  if (!at) return "";
  try { return new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// خريطة Leaflet (OpenStreetMap): مؤشّرات لحظية (تتبّع حيّ) و/أو مسارُ يومٍ + دبابيسُ توقّفات (سجلّ).
// عميل فقط (يستعمل window). CSP يسمح ببلاطات OSM (لا قيود img/connect).
export default function TrackMap({ points, path, stops, className }: { points: TrackPoint[]; path?: [number, number][]; stops?: TrackStopMarker[]; className?: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const LRef = useRef<typeof LeafletNS | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const pathRef = useRef(path);
  pathRef.current = path;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  function render() {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];

    // مسارُ اليوم (السجلّ): خطٌّ متّصل + بدايةٌ ونهاية
    const line = pathRef.current;
    if (line && line.length > 1) {
      L.polyline(line, { color: "#2563eb", weight: 4, opacity: 0.7 }).addTo(layer);
      for (const c of line) bounds.push(c);
      const dot = (color: string) => L.divIcon({ className: "", html: `<div style="transform:translate(-50%,-50%);width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
      L.marker(line[0], { icon: dot("#16a34a") }).addTo(layer).bindPopup("بداية المسار");
      L.marker(line[line.length - 1], { icon: dot("#0284c7") }).addTo(layer).bindPopup("آخر نقطة");
    }

    // دبابيسُ التوقّفات (>٥د)
    for (const s of stopsRef.current ?? []) {
      const poleTxt = s.pole ? ` · ${escapeHtml(s.pole)}${s.poleDistM != null ? ` (${s.poleDistM}م)` : ""}` : "";
      const icon = L.divIcon({
        className: "",
        html: `<div style="transform:translate(-50%,-50%);display:flex;align-items:center;gap:3px;background:#dc2626;color:#fff;padding:2px 8px;border-radius:9999px;font:700 11px system-ui;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.45)">⏱ ${s.minutes}د</div>`,
        iconSize: [0, 0], iconAnchor: [0, 0],
      });
      L.marker([s.lat, s.lng], { icon }).addTo(layer).bindPopup(`توقّفٌ ${s.minutes} دقيقة<br>${fmtClock(s.startedAt)} — ${fmtClock(s.endedAt)}${poleTxt}`);
      bounds.push([s.lat, s.lng]);
    }

    // مؤشّرات لحظية (تتبّع حيّ)
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
      bounds.push([p.lat, p.lng]);
    }

    if (bounds.length === 1) map.setView(bounds[0], 15);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
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

  // إعادة رسم المؤشّرات/المسار عند تغيّر البيانات
  useEffect(() => { render(); }, [points, path, stops]);

  return <div ref={elRef} className={className} />;
}
