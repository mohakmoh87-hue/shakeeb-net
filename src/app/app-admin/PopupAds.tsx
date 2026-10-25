"use client";

import { useCallback, useEffect, useState } from "react";

type Popup = { id: number; text: string | null; image: string | null; audience: string; sort: number; status: string; createdAt: string };

const AUD: Record<string, string> = { all: "الكل", subs: "المشتركون فقط", guests: "غير المشتركين فقط" };

async function shrink(file: File): Promise<string | null> {
  const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
  const img = document.createElement("img");
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = dataUrl; });
  let w = img.naturalWidth, h = img.naturalHeight; const maxDim = 1200;
  if (w > maxDim || h > maxDim) { if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; } else { w = Math.round((w * maxDim) / h); h = maxDim; } }
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let q = 0.82; let out = canvas.toDataURL("image/jpeg", q);
  while (out.length > 380000 && q > 0.4) { q -= 0.12; out = canvas.toDataURL("image/jpeg", q); }
  return out.length > 400000 ? null : out;
}

// 🪟 النوافذُ المنبثقةُ في التطبيق — تملأ الشاشةَ عند فتحه وتُغلَق بـ✕ فتظهر التي بعدها.
// ولكلٍّ جمهورُها، فقد تكون للمشتركين نافذةٌ وللزائرين أخرى في الوقت نفسِه.
export default function PopupAds() {
  const [items, setItems] = useState<Popup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [audience, setAudience] = useState("all");

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/app-admin/popups");
      if (!r.ok) { setErr(`تعذّر الجلب (${r.status})`); return; }
      setItems((await r.json()).items || []);
    } catch { setErr("تعذّر الاتصالُ بالخادم"); }
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setBusy(true);
    try { const u = await shrink(f); if (!u) { setErr("تعذّرت الصورة — جرّب أصغر"); return; } setImage(u); setErr(""); }
    catch { setErr("تعذّرت قراءةُ الصورة"); }
    finally { setBusy(false); }
  }

  async function add() {
    if (!text.trim() && !image) { setErr("اكتب نصّاً أو أضِف صورة"); return; }
    setBusy(true);
    const r = await fetch("/api/app-admin/popups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim(), image, audience }) });
    setBusy(false);
    if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.error || "فشل الحفظ"); return; }
    setText(""); setImage(null); setErr("");
    void load();
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const r = await fetch("/api/app-admin/popups", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    if (!r.ok) { setErr("فشل التعديل"); return; }
    void load();
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 text-sm font-bold text-slate-800">🪟 الإعلانات المنبثقة</div>
      <div className="mb-3 text-[11px] leading-5 text-slate-500">
        تملأ شاشةَ التطبيق عند فتحه، ويغلقها المشتركُ بـ✕ فتظهر التي بعدها مباشرةً. ولكلِّ نافذةٍ جمهورُها — فيمكن أن يرى المشتركُ نافذةً ويرى الزائرُ غيرَها.
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-bold text-slate-700">نافذةٌ جديدة</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} placeholder="نصُّ الإعلان (اتركه فارغاً إن كانت صورةً فقط)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="mt-2 flex items-center gap-3">
          <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">
            {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="text-xl text-slate-300">🖼️</span>}
          </div>
          <div className="flex flex-col gap-1">
            <input type="file" accept="image/*" onChange={onPick} className="text-xs" />
            {image && <button onClick={() => setImage(null)} className="w-fit text-[11px] text-rose-500">إزالة الصورة</button>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-slate-600">تظهر لِـ</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button disabled={busy} onClick={() => void add()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "جارٍ…" : "إضافة"}
          </button>
        </div>
        {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}
      </div>

      <div className="mt-3">
        {!loaded ? <div className="py-6 text-center text-sm text-slate-400">جاري التحميل…</div>
        : items.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">لا نوافذَ بعد</div>
        : (
          <div className="space-y-2">
            {items.map((p) => (
              <div key={p.id} className={`flex gap-3 rounded-xl border border-slate-200 p-2.5 ${p.status === "hidden" ? "opacity-60" : ""}`}>
                {p.image && <img src={p.image} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />}
                <div className="min-w-0 flex-1">
                  {p.text && <div className="text-xs leading-5 text-slate-700">{p.text}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700">{AUD[p.audience] ?? p.audience}</span>
                    <span>الترتيب {p.sort}</span>
                    {p.status === "hidden" && <span className="font-bold text-slate-500">· مخفيّة</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button onClick={() => void patch(p.id, { status: p.status === "visible" ? "hidden" : "visible" })} className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100">{p.status === "visible" ? "إخفاء" : "إظهار"}</button>
                    <select value={p.audience} onChange={(e) => void patch(p.id, { audience: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1 text-[11px]">
                      {Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input type="number" defaultValue={p.sort} onBlur={(e) => { const v = Number(e.target.value); if (v !== p.sort) void patch(p.id, { sort: v }); }} className="w-16 rounded border border-slate-200 px-1.5 py-1 text-[11px]" title="الترتيب" />
                    <button onClick={() => { if (confirm("أرشفةُ هذه النافذة؟ تختفي عن المشتركين وتبقى محفوظة.")) void patch(p.id, { archive: true }); }} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">أرشفة</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
