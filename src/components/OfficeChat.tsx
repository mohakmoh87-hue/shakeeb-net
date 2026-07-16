"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Chat = { id: string; name: string; unread: number; timestamp: number; last: string; isGroup: boolean };
type Msg = { id: string; body: string; fromMe: boolean; timestamp: number; type: string; hasMedia?: boolean };
type Media = { data: string; mimetype: string; filename?: string };

const fmtTime = (ts: number) => ts ? new Date(ts * 1000).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "";

// واجهة واتساب ويب لمكتب (قائمة محادثات + رسائل + رد)
export default function OfficeChat({ officeId, officeName, state, onClose }: { officeId: number; officeName: string; state?: string; onClose: () => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [sel, setSel] = useState<Chat | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [err, setErr] = useState("");
  const [media, setMedia] = useState<Record<string, Media | "loading" | "error">>({});
  const endRef = useRef<HTMLDivElement | null>(null);

  // تنزيل وعرض وسائط رسالة عند الضغط على «عرض»
  async function viewMedia(msgId: string) {
    setMedia((m) => ({ ...m, [msgId]: "loading" }));
    try {
      const r = await fetch(`/api/whatsapp/media?officeId=${officeId}&msgId=${encodeURIComponent(msgId)}`);
      const d = await r.json();
      if (r.ok && d.data) setMedia((m) => ({ ...m, [msgId]: { data: d.data, mimetype: d.mimetype, filename: d.filename } }));
      else { setMedia((m) => ({ ...m, [msgId]: "error" })); setErr(d.error ?? "تعذّر تنزيل الوسائط"); }
    } catch { setMedia((m) => ({ ...m, [msgId]: "error" })); }
  }

  const loadChats = useCallback(async () => {
    const r = await fetch(`/api/whatsapp/chats?officeId=${officeId}`);
    if (r.ok) { const d = await r.json(); setChats(d.chats ?? []); if (d.error) setErr(d.error); else setErr(""); }
    setLoadingChats(false);
  }, [officeId]);

  const loadMsgs = useCallback(async (chatId: string) => {
    const r = await fetch(`/api/whatsapp/messages?officeId=${officeId}&chatId=${encodeURIComponent(chatId)}`);
    if (r.ok) { const d = await r.json(); setMsgs(d.messages ?? []); }
  }, [officeId]);

  useEffect(() => { loadChats(); const i = setInterval(loadChats, 6000); return () => clearInterval(i); }, [loadChats]);
  useEffect(() => {
    if (!sel) return;
    loadMsgs(sel.id);
    const i = setInterval(() => loadMsgs(sel.id), 3500);
    return () => clearInterval(i);
  }, [sel, loadMsgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send() {
    if (!sel || !text.trim()) return;
    setSending(true);
    const t = text.trim();
    setText("");
    const r = await fetch("/api/whatsapp/chat-send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId, chatId: sel.id, text: t }),
    });
    setSending(false);
    if (r.ok) loadMsgs(sel.id);
    else { const d = await r.json().catch(() => ({})); setErr(d.error ?? "تعذّر الإرسال"); setText(t); }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* ترويسة */}
        <div className="flex items-center justify-between bg-emerald-600 px-4 py-2 text-white">
          <h3 className="font-bold">💬 واتساب — {officeName}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-emerald-700">✕</button>
        </div>

        {err && <div className="bg-amber-50 px-4 py-1 text-center text-xs text-amber-700">{err}</div>}

        {state && state !== "ready" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <span className="text-4xl">🔌</span>
            <div className="text-lg font-bold text-slate-700">واتساب هذا المكتب غير متصل</div>
            <div className="text-sm text-slate-500">اربطه بمسح رمز QR من صفحة <b>المكاتب</b> ← واتساب المكتب، ثم عُد هنا.</div>
          </div>
        ) : (
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* قائمة المحادثات (شريط أعلى على الهاتف / عمود جانبي على الكمبيوتر) */}
          <div className="h-40 w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 md:h-auto md:w-[300px] md:border-b-0 md:border-l">
            {loadingChats ? (
              <div className="p-4 text-center text-sm text-slate-400">جاري تحميل المحادثات...</div>
            ) : chats.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-400">لا توجد محادثات</div>
            ) : chats.map((c) => (
              <button key={c.id} onClick={() => setSel(c)} className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 text-right hover:bg-white ${sel?.id === c.id ? "bg-white" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">{c.name}{c.isGroup ? " 👥" : ""}</div>
                  <div className="truncate text-xs text-slate-500">{c.last}</div>
                </div>
                {c.unread > 0 && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
              </button>
            ))}
          </div>

          {/* الرسائل */}
          <div className="flex flex-1 flex-col bg-[#efeae2]">
            {!sel ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">اختر محادثة للعرض والرد</div>
            ) : (
              <>
                <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{sel.name}</div>
                <div className="flex-1 space-y-1.5 overflow-y-auto p-4">
                  {msgs.map((m) => {
                    const md = media[m.id];
                    return (
                    <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${m.fromMe ? "bg-emerald-100 text-slate-800" : "bg-white text-slate-800"}`}>
                        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                        {m.hasMedia && (
                          md && md !== "loading" && md !== "error" ? (
                            <MediaView media={md} />
                          ) : (
                            <button
                              onClick={() => viewMedia(m.id)}
                              disabled={md === "loading"}
                              className="mt-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                            >
                              {md === "loading" ? "جاري التنزيل…" : md === "error" ? "أعد المحاولة" : "عرض 📷"}
                            </button>
                          )
                        )}
                        <div className="mt-0.5 text-left text-[10px] text-slate-400" dir="ltr">{fmtTime(m.timestamp)}</div>
                      </div>
                    </div>
                    );
                  })}
                  <div ref={endRef} />
                </div>
                <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 p-3">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="اكتب رسالة..."
                    className="flex-1 rounded-full border border-slate-300 px-4 py-2 outline-none focus:border-emerald-500"
                  />
                  <button onClick={send} disabled={sending || !text.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">➤</button>
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// عرض الوسائط المُنزَّلة حسب النوع (صورة/فيديو/صوت/ملف)
function MediaView({ media }: { media: Media }) {
  const src = `data:${media.mimetype};base64,${media.data}`;
  const mt = media.mimetype || "";
  if (mt.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={src} download={media.filename || "image"} target="_blank" rel="noreferrer"><img src={src} alt="صورة" className="mt-1 max-h-64 rounded-lg" /></a>;
  }
  if (mt.startsWith("video/")) {
    return <video src={src} controls className="mt-1 max-h-64 rounded-lg" />;
  }
  if (mt.startsWith("audio/")) {
    return <audio src={src} controls className="mt-1 w-56" />;
  }
  return (
    <a href={src} download={media.filename || "file"} className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
      📄 تنزيل {media.filename || "الملف"}
    </a>
  );
}
