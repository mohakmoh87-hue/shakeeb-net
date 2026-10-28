"use client";

import { useCallback, useEffect, useState } from "react";

type AppPkg = { id: number; name: string; price: number | null; published: boolean; visible: boolean; note: string; sort: number };
type Aud = "sub_active" | "sub_expired" | "account" | "guest";
type Offer = { id: number; text: string | null; image: string | null; status: string; audience?: string; packages?: string | null; targetFrom: string | null; targetTo: string | null; targetCount: number; createdBy: string | null; createdAt: string };

// 🎯 جمهورُ العرض — أربعةُ أصنافٍ تُختار معاً (طلبُ محمد 2026-10-28)
const AUDS: { key: Aud; label: string; hint: string }[] = [
  { key: "sub_active", label: "مشترك فعّال", hint: "اشتراكُه ساري المفعول" },
  { key: "sub_expired", label: "مشترك منتهٍ", hint: "انتهى اشتراكُه قبل أكثرَ من شهر" },
  { key: "account", label: "غير مشترك", hint: "له حسابٌ في التطبيق بلا اشتراك" },
  { key: "guest", label: "زائر", hint: "يتصفّح بلا حساب" },
];
// القيمُ الثلاثُ القديمةُ تُعرَض بمعناها نفسِه الذي يفهمه الخادم
const LEGACY: Record<string, Aud[]> = {
  subs: ["sub_active"],
  guests: ["sub_expired", "account", "guest"],
  all: ["sub_active", "sub_expired", "account", "guest"],
};
const audsOf = (a?: string): Aud[] => {
  const raw = (a ?? "").trim();
  if (!raw) return LEGACY.subs;
  if (LEGACY[raw]) return LEGACY[raw];
  const set = new Set(raw.split(","));
  return AUDS.map((x) => x.key).filter((k) => set.has(k));
};
const audLabel = (a?: string) => {
  const ks = audsOf(a);
  if (ks.length === AUDS.length) return "للكلّ";
  return ks.map((k) => AUDS.find((x) => x.key === k)!.label).join(" · ") || "—";
};
type Preview = { count: number; sample: { name: string | null; netUser: string | null; dateTo: string | null }[] };

const fmt = (n: number | null) => (n == null ? "بلا سعر" : `${n.toLocaleString("en-US")} د.ع`);
const day = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");
const PHOTO_W = 1280, PHOTO_H = 720;

async function shrink(file: File): Promise<{ url: string; w: number; h: number; kb: number } | null> {
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
  if (out.length > 400000) return null;
  return { url: out, w: img.naturalWidth, h: img.naturalHeight, kb: Math.round(out.length / 1024) };
}

// 📦🎁 «الباقات والعروض» — ما يراه المشتركُ في صفحة الباقات والعروض بتطبيقه.
// خيارانِ كما طلب محمد: باقاتُ الاشتراكات (تُنشَر بأسعارها كما أدخلها)، والعروضُ
// الخاصّةُ (نصٌّ/صورةٌ/الاثنان) لمجموعةٍ تُحدَّد بتاريخ الانتهاء بين تاريخَين.
export default function AppPackagesOffers() {
  const [tab, setTab] = useState<"packages" | "offers">("packages");
  const [pkgs, setPkgs] = useState<AppPkg[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [msg, setMsg] = useState("");
  // ⚠️ الابتلاعُ الصامت كان يُظهر فشلَ الجلب بصورة «لا باقات» — الآن يُقال السبب
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoInfo, setPhotoInfo] = useState<{ w: number; h: number; kb: number } | null>(null);
  const [auds, setAuds] = useState<Aud[]>(["sub_active"]);
  const [pkgIds, setPkgIds] = useState<number[]>([]);
  const [byWindow, setByWindow] = useState(false); // تثبيتُ مجموعةٍ بتاريخ الانتهاء
  const toggleAud = (k: Aud) => { setAuds((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); setPreview(null); setErr(""); };
  const togglePkg = (id: number) => setPkgIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const hasSubClass = auds.includes("sub_active") || auds.includes("sub_expired");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const r = await fetch("/api/store/app-packages");
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setLoadErr(d?.error || `تعذّر جلبُ الباقات (${r.status})`);
      } else {
        const d = await r.json();
        setPkgs(d.items || []);
      }
    } catch {
      setLoadErr("تعذّر الاتصالُ بالخادم");
    }
    try {
      const r = await fetch("/api/store/offers");
      if (r.ok) setOffers((await r.json()).items || []);
    } catch { /* العروضُ ثانويّةٌ هنا */ }
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function patchPkg(p: AppPkg, body: Record<string, unknown>) {
    setMsg("");
    const r = await fetch("/api/store/app-packages", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: p.id, ...body }) });
    if (!r.ok) { const d = await r.json().catch(() => null); setMsg(d?.error || "فشل الحفظ"); return; }
    load();
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const res = await shrink(file);
      if (!res) { setErr("تعذّرت الصورة — جرّب صورةً أصغر"); return; }
      setPhoto(res.url); setPhotoInfo({ w: res.w, h: res.h, kb: res.kb });
    } catch { setErr("تعذّرت قراءةُ الصورة"); }
    finally { setBusy(false); }
  }

  async function doPreview() {
    setErr(""); setPreview(null);
    if (!from || !to) { setErr("حدّد تاريخَي الانتهاء"); return; }
    const r = await fetch(`/api/store/offers?preview=1&from=${from}&to=${to}`);
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.error || "تعذّرت المعاينة"); return; }
    setPreview(d);
  }

  async function send() {
    setErr("");
    if (!text.trim() && !photo) { setErr("اكتب نصَّ العرض أو أضِف صورةً (أو الاثنين)"); return; }
    if (auds.length === 0) { setErr("اختر جمهورَ العرض"); return; }
    const useWindow = byWindow && hasSubClass;
    if (useWindow && (!from || !to)) { setErr("حدّد تاريخَي الانتهاء"); return; }
    setBusy(true);
    const body = {
      text: text.trim(), image: photo, audiences: auds, packageIds: pkgIds,
      ...(useWindow ? { from, to } : {}),
    };
    const r = await fetch("/api/store/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error || "فشل الإرسال"); return; }
    setText(""); setPhoto(null); setPhotoInfo(null); setPreview(null);
    setMsg(useWindow ? `✓ وصل العرضُ ${d?.count ?? 0} مشتركاً` : `✓ نُشر العرضُ — ${audLabel(auds.join(","))}`);
    load();
  }

  async function patchOffer(o: Offer, body: Record<string, unknown>) {
    const r = await fetch("/api/store/offers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, ...body }) });
    if (!r.ok) { setMsg("فشل التعديل"); return; }
    load();
  }

  const shownCount = pkgs.filter((p) => p.published && p.visible).length;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 text-sm font-bold text-slate-800">📱 الباقات والعروض — في تطبيق المشترك</div>
      <div className="mb-3 text-[11px] text-slate-500">ما تضعه هنا يظهر لمشتركيك في صفحة «الباقات والعروض» بالتطبيق.</div>

      <div className="mb-3 flex gap-2">
        <button onClick={() => setTab("packages")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "packages" ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          باقات الاشتراكات {shownCount > 0 && <span className="text-[10px]">({shownCount})</span>}
        </button>
        <button onClick={() => setTab("offers")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "offers" ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          العروض الخاصة {offers.length > 0 && <span className="text-[10px]">({offers.length})</span>}
        </button>
      </div>

      {msg && <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{msg}</div>}

      {tab === "packages" ? (
        <>
          <div className="mb-2 text-[11px] text-slate-500">الأسعارُ من صفحة «الباقات» حيّاً — عدّلها هناك ويتبعها التطبيق. ولا يظهر للمشترك إلّا ما نشرتَه.</div>
          {loadErr ? (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadErr}
              <button onClick={() => void load()} className="mr-3 rounded bg-red-100 px-2 py-1 text-xs font-bold hover:bg-red-200">إعادة المحاولة</button>
            </div>
          ) : !loaded ? (
            <div className="py-8 text-center text-sm text-slate-400">جاري التحميل…</div>
          ) : pkgs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
              لا باقاتٍ في حسابك — أضِفها من صفحة «الباقات»
              <div className="mt-1 text-[11px] text-slate-400">تُجلب باقاتُ وكيلك بنفسِ ترشيح صفحة «الباقات» تماماً.</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pkgs.map((p) => {
                const on = p.published && p.visible;
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <div className="min-w-[8rem] flex-1">
                      <div className="text-sm font-bold text-slate-800">{p.name}</div>
                      <div className="text-[12px] font-extrabold text-emerald-700">{fmt(p.price)}</div>
                    </div>
                    <input
                      defaultValue={p.note}
                      onBlur={(e) => { if (e.target.value.trim() !== p.note) void patchPkg(p, { note: e.target.value, visible: p.visible || !p.published ? p.visible : false, published: p.published ? undefined : undefined }); }}
                      placeholder="وصفٌ اختياريّ (سرعة، تفاصيل…)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs sm:w-56"
                    />
                    <button
                      onClick={() => void patchPkg(p, on ? { published: false } : { visible: true })}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${on ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {on ? "✓ يظهر في التطبيق" : "نشرٌ في التطبيق"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-xs font-bold text-slate-700">عرضٌ جديد</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3} placeholder="نصُّ العرض (اتركه فارغاً إن كانت صورةً فقط)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="mt-2 flex items-center gap-3">
              <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">
                {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <span className="text-xl text-slate-300">🖼️</span>}
              </div>
              <div className="flex flex-col gap-1">
                <input type="file" accept="image/*" onChange={onPickPhoto} className="text-xs" />
                {photo && <button onClick={() => { setPhoto(null); setPhotoInfo(null); }} className="w-fit text-[11px] text-rose-500">إزالة الصورة</button>}
              </div>
            </div>
            <div className="mt-1 text-[11px] leading-5 text-slate-500">
              المقاسُ المقترح للصورة <b dir="ltr">{PHOTO_W}×{PHOTO_H}</b> (16:9).
              {photoInfo && (() => {
                const off = Math.abs(photoInfo.w / photoInfo.h - PHOTO_W / PHOTO_H) > 0.18;
                return <span className={off ? "text-amber-700" : "text-emerald-700"}> صورتُك <b dir="ltr">{photoInfo.w}×{photoInfo.h}</b> · <b dir="ltr">{photoInfo.kb}</b> ك.ب{off ? " — نسبتُها تخالف 16:9 فسيُقتَطع جزءٌ منها." : " ✓"}</span>;
              })()}
            </div>

            <div className="mt-3 text-xs font-bold text-slate-700">لمن يُرسَل؟ (يمكن اختيارُ أكثرَ من صنف)</div>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {AUDS.map((a) => {
                const on = auds.includes(a.key);
                return (
                  <button key={a.key} onClick={() => toggleAud(a.key)}
                    className={`rounded-lg px-3 py-2 text-right text-[11px] font-bold leading-4 ${on ? "bg-mynet-blue text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"}`}>
                    {on ? "✓ " : ""}{a.label}
                    <span className={`mt-0.5 block text-[10px] font-normal ${on ? "text-white/80" : "text-slate-500"}`}>{a.hint}</span>
                  </button>
                );
              })}
            </div>

            {/* 📦 ترشيحُ الباقة — للمشتركين وحدَهم، فالزائرُ لا باقةَ له */}
            {hasSubClass && pkgs.length > 0 && (
              <>
                <div className="mt-3 text-xs font-bold text-slate-700">باقاتٌ بعينها؟ <span className="font-normal text-slate-500">(بلا اختيارٍ = كلُّ الباقات)</span></div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {pkgs.map((p) => {
                    const on = pkgIds.includes(p.id);
                    return (
                      <button key={p.id} onClick={() => togglePkg(p.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-bold ${on ? "bg-emerald-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100"}`}>
                        {on ? "✓ " : ""}{p.name}
                      </button>
                    );
                  })}
                  {pkgIds.length > 0 && (
                    <button onClick={() => setPkgIds([])} className="rounded-full px-2 py-1 text-[11px] text-rose-500">مسح</button>
                  )}
                </div>
              </>
            )}

            {hasSubClass && (
              <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={byWindow} onChange={(e) => { setByWindow(e.target.checked); setPreview(null); }} />
                تثبيتُ المجموعة بتاريخ انتهاء الاشتراك
              </label>
            )}
            {byWindow && hasSubClass && <>
            <div className="mt-2 text-xs font-bold text-slate-700">بتاريخ انتهاء الاشتراك</div>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block text-[11px] text-slate-600">من تاريخ</span>
                <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="block"><span className="mb-1 block text-[11px] text-slate-600">إلى تاريخ</span>
                <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            </div>
            <button onClick={() => void doPreview()} className="mt-2 rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-200">👁️ من سيستلمه؟</button>
            {preview && (
              <div className="mt-2 rounded-lg bg-white p-2.5 text-[11px] ring-1 ring-slate-200">
                <b className="text-slate-800">{preview.count.toLocaleString("en-US")}</b> مشتركاً ينتهي اشتراكُه في هذه الفترة.
                {preview.sample.length > 0 && (
                  <div className="mt-1 text-slate-500">
                    {preview.sample.map((s, i) => <span key={i} className="mr-2 inline-block">{s.name || s.netUser} <span dir="ltr" className="text-slate-400">({day(s.dateTo)})</span></span>)}
                    {preview.count > preview.sample.length && <span className="text-slate-400">…</span>}
                  </div>
                )}
              </div>
            )}
            </>}
            {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}
            <button disabled={busy} onClick={() => void send()} className="mt-3 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? "جارٍ الإرسال…" : "إرسالُ العرض"}
            </button>
            <div className="mt-1.5 text-[11px] text-slate-400">
              {byWindow && hasSubClass
                ? "الجمهورُ يُثبَّت لحظةَ الإرسال — فتجديدُ المشترك لا يُخرجه من عرضٍ وصله."
                : "يظهر لمن يفتح التطبيق وهو من هذا الجمهور — بلا تثبيتِ أسماء."}
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-xs font-bold text-slate-700">العروضُ المُرسَلة</div>
            {offers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">لا عروضَ بعد</div>
            ) : (
              <div className="space-y-2">
                {offers.map((o) => (
                  <div key={o.id} className={`flex gap-3 rounded-xl border border-slate-200 p-2.5 ${o.status === "hidden" ? "opacity-60" : ""}`}>
                    {o.image && <img src={o.image} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />}
                    <div className="min-w-0 flex-1">
                      {o.text && <div className="text-xs leading-5 text-slate-700">{o.text}</div>}
                      <div className="mt-1 text-[10px] text-slate-400">
                        <span className="font-bold text-slate-600">{audLabel(o.audience)}</span>
                        {o.packages && <> · <span className="text-emerald-700">{o.packages.split(",").map((id) => pkgs.find((p) => p.id === Number(id))?.name ?? id).join(" · ")}</span></>}
                        {o.targetCount > 0 && <> · <span dir="ltr">{day(o.targetFrom)} → {day(o.targetTo)}</span> · {o.targetCount.toLocaleString("en-US")} مشترك</>}
                        {o.createdBy ? ` · ${o.createdBy}` : ""}
                        {o.status === "hidden" && <span className="font-bold text-slate-500"> · مخفيّ</span>}
                      </div>
                      <div className="mt-1.5 flex gap-1">
                        <button onClick={() => void patchOffer(o, { status: o.status === "visible" ? "hidden" : "visible" })} className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100">{o.status === "visible" ? "إخفاء" : "إظهار"}</button>
                        <button onClick={() => { if (confirm("أرشفةُ هذا العرض؟ سيختفي عن المشتركين ويبقى محفوظاً.")) void patchOffer(o, { archive: true }); }} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">أرشفة</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
