"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MapButton from "@/components/MapButton";
import TechOpsBar from "@/components/TechOpsBar";
import TechnicianManager from "@/components/TechnicianManager";
import OdooConfigButton from "@/components/OdooConfigButton";
import LeaveReview from "@/components/LeaveReview";
import CardTypeManager from "@/components/CardTypeManager";
import DeductionReview from "@/components/DeductionReview";
import MapProposalReview from "@/components/MapProposalReview";
import DeletedCardsModal from "@/components/DeletedCardsModal";
import AchievementsModal from "@/components/AchievementsModal";
import AgentCompanyOutbox from "./AgentCompanyOutbox";
import NotificationsBell from "@/components/NotificationsBell";
import { isPageActive } from "@/lib/usePolling";
import { slaStateOf, fmtMin, SLA_ALARM_MIN_DEFAULT, SLA_SEND_MIN_DEFAULT, type SlaCard } from "@/lib/odooSla";
import FieldAppMenu from "@/components/FieldAppMenu";
import { FieldTrackerProvider } from "@/components/FieldTracker";
import { hasTrialSkin } from "@/components/trialSkin";

type Board = { id: number; name: string };
type List = { id: number; name: string; position: number; timeTracked?: boolean };
type Card = {
  id: number; listId: number; title: string; description: string | null;
  assignee: string | null; technicianId: number | null; kind: string;
  label: string | null; dueDate: string | null; position: number; done: boolean;
  amount: number | null; subAmount: number | null; serviceDetails: string | null; completedAt: string | null;
  materialsInfo: string | null; techNote: string | null;
  startedAt: string | null; durationSec: number | null; postponedTo: string | null;
  history: string | null; createdAt: string | null;
  viaOdoo?: boolean; usernameRequired?: boolean; odooTicketId?: number | null; // بطاقات أودو
  // مهلة سوبر سيل (SLA)
  odooCreatedAt?: string | null; odooFetchedAt?: string | null; odooPhone?: string | null;
  // اسمُ المشترك — يُعرَض على الوجه قبل فتح البطاقة (طلبُ محمد 2026-08-13)
  subscriberName?: string | null;
  userPassword?: string | null; // باسورد يوزر الساس — يظهر داخل البطاقة عند فتحها فقط، لا على الوجه
  slaNoteAt?: string | null; slaWaQueuedAt?: string | null; slaWaSentAt?: string | null; slaWaError?: string | null;
};
// ═════ 🧰 سجلُّ صيانات مشترك البطاقة — داخل البطاقة نفسِها (طلبُ محمد 2026-08-21) ═════
// «في كلّ بطاقةٍ تُرفَع يظهر أسفلَها سجلُّ صيانات هذا المشترك، يضغط عليه الفنيُّ أو المديرُ
//  أو المستخدم فتتمدّد البطاقةُ إلى الأسفل وفيها السجلُّ بتفاصيله».
// 📱 وشرطُه الصريح: **لا إزاحةَ للكتابة يميناً أو يساراً أو أعلى أو أسفل، ولا تمريرَ
//    لرؤية التفاصيل** — والفنيُّ يفتحها من تطبيقه (شاشةُ هاتف). ولذلك:
//   · لا جدولَ ولا أعمدةَ ثابتةَ العرض (الجدولُ هو ما يُزيح النصَّ أفقيّاً على الهاتف).
//   · كلُّ سطرٍ **بطاقةٌ مستقلّةٌ بعرض الشاشة**، وعناوينُها تلتفّ (`break-words`) والتفاصيل
//     `whitespace-pre-wrap` — فالنصُّ ينزل سطراً جديداً ولا يخرج أبداً عن الحافّة.
//   · **بلا `overflow` داخليٍّ ولا ارتفاعٍ أقصى**: تتمدّد البطاقةُ إلى الأسفل كما طلب،
//     فلا يُطلَب من الفنيّ تمريرُ صندوقٍ داخل صندوق (وتمريرُ النافذة نفسِها كما كان).
//   · ولا يُجلَب شيءٌ قبل الضغط (فتحُ البطاقة يبقى بسرعته) — والزرُّ يقول العدد بعدها.
function MaintenanceHistory({ cardId }: { cardId: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [logs, setLogs] = useState<MaintLog[]>([]);
  const [who, setWho] = useState<{ name: string | null; netUser: string | null } | null>(null);
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (state === "loading" || logs.length) return;
    setState("loading");
    try {
      const r = await fetch(`/api/field/maintenance?cardId=${cardId}`);
      const d = (await r.json()) as { logs?: MaintLog[]; subscriber?: { name: string | null; netUser: string | null } | null; error?: string };
      if (!r.ok) throw new Error(d.error ?? "تعذّر الجلب");
      setLogs(d.logs ?? []); setWho(d.subscriber ?? null); setState("idle");
    } catch { setState("error"); }
  };
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button onClick={() => void toggle()} className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-right">
        <span className="text-xs font-bold text-slate-700">🧰 سجل صيانات هذا المشترك</span>
        <span className="shrink-0 text-[11px] font-semibold text-slate-400">
          {state === "loading" ? "…" : logs.length ? `${logs.length} صيانة` : ""} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 px-2 py-2">
          {state === "loading" && <div className="py-2 text-center text-[11px] text-slate-400">جارٍ الجلب…</div>}
          {state === "error" && <div className="py-2 text-center text-[11px] text-rose-600">تعذّر جلب السجل — أعد المحاولة</div>}
          {state === "idle" && who && (
            <div className="px-1 pb-1 text-[11px] text-slate-500">
              <b className="text-slate-700">{who.name ?? "—"}</b>{who.netUser ? <span dir="ltr"> · {who.netUser}</span> : null}
            </div>
          )}
          {state === "idle" && logs.length === 0 && (
            <div className="py-2 text-center text-[11px] text-slate-400">لا صيانات سابقة لهذا المشترك</div>
          )}
          {logs.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span dir="ltr" className="font-semibold text-slate-500">{fmtDateTime(m.date)}</span>
                {m.kind && <span className="rounded bg-white px-1.5 py-0.5 font-bold text-slate-600">{m.kind}</span>}
                {m.technicianName && <span className="font-semibold text-slate-600">👷 {m.technicianName}</span>}
                {m.durationSec != null && <span className="text-slate-500">⏱ {fmtDuration(m.durationSec)}</span>}
                {!!m.amount && <b className="text-emerald-700">{Number(m.amount).toLocaleString("en-US")} د.ع</b>}
              </div>
              {m.cardTitle && <div className="mb-0.5 break-words text-[11px] font-semibold text-slate-500">{m.cardTitle}</div>}
              <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-700">{m.details}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// أحداث سجل تغييرات البطاقة (JSON داخل حقل history)
type MaintLog = { id: number; date: string; details: string; technicianName: string | null; cardTitle: string | null; kind: string | null; durationSec: number | null; amount: number | null };
type CardEvent = { at: string; by: string; text: string };
const parseHistory = (h?: string | null): CardEvent[] => { try { return h ? (JSON.parse(h) as CardEvent[]) : []; } catch { return []; } };
// بطاقة أُعيدت من الأرشيف (من سجلها) — لعرض شارة «من الأرشيف» على وجهها
const wasRestored = (h?: string | null): boolean => parseHistory(h).some((e) => e.text.includes("إعادة البطاقة من الأرشيف"));
// حان يومُ التأجيل المقرّر؟ (مقارنةٌ باليوم بتوقيت بغداد) — عليه يومض شريطُ «مؤجّلة» أحمرَ
const postponeDueNow = (iso?: string | null): boolean => {
  if (!iso) return false;
  const off = 3 * 60 * 60 * 1000;
  const p = new Date(new Date(iso).getTime() + off);
  const n = new Date(Date.now() + off);
  const pDay = p.getUTCFullYear() * 10000 + p.getUTCMonth() * 100 + p.getUTCDate();
  const nDay = n.getUTCFullYear() * 10000 + n.getUTCMonth() * 100 + n.getUTCDate();
  return pDay <= nDay;
};
// لون فئة العمود (طراز المدير الجديد بالمتصفح): اسم أبيض على خلفية لون فئته —
// توصيل برتقالي · صيانة لاجورد · تنصيب أخضر · بالشوب رمادي · المنجزة أخضر داكن
const listCatColor = (name: string): string => {
  if (name.includes("توصيل")) return "var(--cat-delivery)";
  if (name.includes("صيان")) return "var(--cat-maint)";
  if (name.includes("تنصيب") || name.includes("نصب")) return "var(--cat-install)";
  if (name.includes("شوب")) return "var(--cat-shop)";
  if (name.includes("منجز")) return "var(--cat-done)";
  return "var(--navy-3)";
};

// (أُلغي رفع صور العمل نهائياً بقرار محمد 2026-07-29)

// تنسيق مدة بالثواني إلى نص عربي مقروء
function fmtDuration(sec: number | null): string {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} س ${m} د`;
  if (m > 0) return `${m} د`;
  return `${sec} ث`;
}
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
type Office = { id: number; name: string | null };
type Technician = { id: number; name: string; phone: string | null; isSupport?: boolean };
type CardType = { id: number; name: string; deliveryOnly: boolean; execMinutes?: number | null; overrunDeduction?: number | null };

// لون ثابت لكل نوع بطاقة (تصنيف) — يُشتق من اسم النوع فيبقى ثابتاً لكل تصنيف
const KIND_COLORS = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-pink-500", "bg-cyan-600", "bg-red-500", "bg-lime-600", "bg-indigo-500", "bg-orange-500"];
const kindColor = (name: string) => KIND_COLORS[[...(name || "")].reduce((a, ch) => a + ch.charCodeAt(0), 0) % KIND_COLORS.length];
const fmtDue = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }) : null);
// أسطر مخزّنة ضمن وصف البطاقة. رقم الهاتف من القاعدة (📱 الهاتف) يظهر بفتح البطاقة فقط.
const lineOf = (desc: string | null | undefined, emoji: string, label: string): string | null => {
  const re = new RegExp(`${emoji}\\s*${label}:\\s*([^\\n]+)`);
  const v = desc?.match(re)?.[1]?.trim();
  return v && v !== "—" ? v : null;
};
const phoneOf = (desc?: string | null): string | null => lineOf(desc, "📱", "الهاتف"); // هاتف القاعدة (المخزون)
// على وجه البطاقة (بلا فتح): الهاتف الإضافي من النافذة المنبثقة إن وُجد، والملاحظة المكتوبة فيها
const facePhoneOf = (desc?: string | null): string | null => lineOf(desc, "📞", "هاتف إضافي");
const faceNoteOf = (desc?: string | null): string | null => lineOf(desc, "📝", "ملاحظة");
// الهاتف الظاهر على وجه البطاقة: المُدخَل في النافذة المنبثقة إن وُجد، وإلا الرقم المخزون للمشترك
const faceCallPhone = (desc?: string | null): string | null => facePhoneOf(desc) ?? phoneOf(desc);

// ═════ الهاتفُ يُتَّصل به لا يُنسخ (طلبُ محمد 2026-08-19) ═════
// «بدل نسخ الرقم ووضعه في الهاتف من اجل الاتصال به»: الرقمُ رابطُ `tel:` فيضغطه
// الفنيُّ فيفتح الهاتفُ قائمةَ برامج الاتصال (الهاتف · واتساب · فايبر · وييف — كلُّ
// ما يتسجّل لنداءات tel على جهازه). وشارةُ «اتصال» تقول إنّه يُضغَط لا يُقرأ فقط.
// ⚠️ و`stopPropagation` شرطٌ: البطاقةُ كلُّها زرُّ فتحٍ، فبلاه تنفتح النافذةُ بدل الاتصال.
function CallPhone({ phone }: { phone: string }) {
  // ⚠️ `\d` لا `d`: كُتب هذا السطرُ أوّلَ مرّةٍ عبر سكربتٍ ابتلع الشرطةَ المائلة، فصار
  //    المعنى «احذفْ كلَّ ما ليس الحرفَ d أو +» ⇒ يمحو أرقامَ الهاتف كلَّها فيصير الناتجُ
  //    فارغاً، فيرتدّ إلى النصّ العاديّ ولا يظهر زرُّ الاتصال أبداً (بلاغُ محمد).
  const clean = phone.replace(/[^\d+]/g, "");
  if (!clean) return <span dir="ltr">📞 {phone}</span>;
  return (
    <a
      href={`tel:${clean}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded hover:bg-emerald-50"
      title="اتصال بالمشترك"
    >
      <span dir="ltr">📞 {phone}</span>
      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">اتصال</span>
    </a>
  );
}
// عنوان البطاقة هو اليوزر نفسه، والوصف يحمل سطر «👤 اليوزر: …» أيضاً (يبقى مخزَّناً لأن
// مطابقة المكافآت الآلية تقرأه) — فكان يُعرض مرّتين في التفاصيل. يُطوى السطر عند العرض
// إن كان نفس العنوان حرفاً بحرف، ويبقى ظاهراً إن اختلف (فاختلافه خبرٌ يُقرأ).
const descNoDupUser = (desc?: string | null, title?: string | null): string => {
  const t = (title ?? "").trim();
  if (!desc || !t) return desc ?? "";
  return desc
    .split("\n")
    .filter((ln) => {
      const m = ln.match(/^\s*👤\s*اليوزر:\s*(.+?)\s*$/);
      return !(m && m[1] === t);
    })
    .join("\n");
};

export default function FieldManagementPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [odooActive, setOdooActive] = useState(false); // أودو نشط للمكتب المعروض (مفعّل أو به بطاقات مفتوحة) — يحكم إظهار عمود «تذاكر أودو»
  const [portalOn, setPortalOn] = useState(true); // سوبر سيل مفعّلة؟ — عند الإطفاء يُمحى اسمُها من «مهلة سوبر سيل» على بطاقات أودو
  // ⏳ مهلة سوبر سيل: عتبتا المكتب + ساعةٌ تنبض كلّ ٣٠ث ليتحرّك العدّاد بلا طلبٍ للخادم
  const [canAddCards, setCanAddCards] = useState(true); // الفنيّ: خيار المدير «إضافة بطاقات» (افتراضه مسموح)
  const [slaOn, setSlaOn] = useState(false); // الميزة ١ «إنذارات أودو» لهذا المكتب
  const [slaAlarmMin, setSlaAlarmMin] = useState(SLA_ALARM_MIN_DEFAULT);
  const [slaSendMin, setSlaSendMin] = useState(SLA_SEND_MIN_DEFAULT);
  const [slaNow, setSlaNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setSlaNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  // 🧪 علامةُ «مؤجّلة» الجانبيّة تظهر في تطبيق الهاتف وحده (جلد التجربة) — لا على الموقع
  const [trialOn, setTrialOn] = useState(false);
  useEffect(() => { setTrialOn(hasTrialSkin()); }, []);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [newList, setNewList] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [cardText, setCardText] = useState("");
  const [cardTypes, setCardTypes] = useState<CardType[]>([]);
  const [cardKind, setCardKind] = useState("صيانة");
  const [cardTech, setCardTech] = useState("");
  const [cardDue, setCardDue] = useState("");
  const [sel, setSel] = useState<Card | null>(null);
  const [completing, setCompleting] = useState<Card | null>(null);
  const [postponing, setPostponing] = useState<Card | null>(null);
  // ===== السحب: ترى ما تحمله وأين سيقع قبل أن تُفلته (طلب محمد 2026-08-05) =====
  // كان السحب «وضعاً» خفيّاً: تضغط مطوّلاً فتبهت البطاقة قليلاً، ثم ترفع إصبعك فوق أخرى
  // فتُبدَّل — بلا أن ترى ما تحمله ولا أين سيستقرّ. الآن نسخةٌ منها ترتفع تحت إصبعك مائلةً
  // بظلّها، والبطاقات تنزاح بانسيابٍ لتفتح لها المكان، وسلّتها الأصلية تنطوي.
  type DragCard = { kind: "card"; id: number; fromList: number; toList: number; index: number; w: number; h: number; offX: number; offY: number; x: number; y: number };
  type DragList = { kind: "list"; id: number; index: number; w: number; h: number; offX: number; offY: number; x: number; y: number };
  const [drag, setDrag] = useState<DragCard | DragList | null>(null);
  const dragRef = useRef<DragCard | DragList | null>(null);
  // أ-٤ · `mouse`: بالفأرة يبدأ السحبُ من أوّل حركةٍ بلا ضغطٍ مطوّل — والمطوّلُ يبقى للمس
  // حصراً، فهو الذي يُبقي تمريرَ الشاشة باللمس ممكناً على الهاتف
  const pendRef = useRef<{ kind: "card" | "list"; id: number; x: number; y: number; el: HTMLElement; mouse: boolean } | null>(null);
  const draggedAt = useRef(0); // لمنع فتح البطاقة بالنقرة التي أنهت السحب
  const boardRef = useRef<HTMLDivElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // الفنيون والمكاتب (لوحة مستقلّة لكل مكتب، والمدير يختار المكتب)
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  // أ-٢٣ · لوحاتُ الساس لكلّ مكتب — يُرسلها الخادمُ **فقط لمكتبٍ له أكثرُ من لوحة**
  const [officePanels, setOfficePanels] = useState<Record<number, { id: number; label: string | null }[]>>({});
  const [officeId, setOfficeId] = useState<number | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canOperate, setCanOperate] = useState(true); // الكتابة على المكتب المعروض (الموظف: مكتبه فقط)
  const [myOfficeId, setMyOfficeId] = useState<number | null>(null);
  const [role, setRole] = useState<string>("");
  const [myName, setMyName] = useState("");
  const [supportInfo, setSupportInfo] = useState<string | null>(null); // شريط دعم اليوم الكامل (للفني المُعار)
  const [supportOfficeId, setSupportOfficeId] = useState<number | null>(null); // مكتب الدعم (لخريطة بطاقات «دعم مؤقت»)
  // 🎫 تذاكرُ المشتركين: طلباتُ اشتراكٍ جديدةٌ من التطبيق، مُوجَّهةٌ لهذا الوكيل بأقرب عامود
  const [subTickets, setSubTickets] = useState<{ id: number; name: string; phone: string; area: string | null; note: string | null; lat: number | null; lng: number | null; nearestPole: string | null; poleDistanceM: number | null; towerId: number | null; type: string | null; status: string; createdAt: string; source: string | null; dueAt: string | null }[]>([]);
  // 🏬 طلباتُ متجر الوكيل الواصلةُ له — عمودٌ خاصٌّ يظهر حين تأتيه طلبات (يختفي حين يفرغ)
  const [storeOrders, setStoreOrders] = useState<{ id: number; subscriberName: string | null; productTitle: string; price: number | null; qty: number; phone: string; address: string; note: string | null; status: string; createdAt: string; fulfillment: string; deliveryFee: number | null; installFee: number | null; total: number | null; lines: { productTitle: string; price: number | null; qty: number }[] }[]>([]);
  const [myTechId, setMyTechId] = useState<number | null>(null); // معرّف الفني الحالي (للتحويل على نفسه)
  const [techModal, setTechModal] = useState(false);
  const [supportModal, setSupportModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leavePending, setLeavePending] = useState(0);
  const [typesModal, setTypesModal] = useState(false);
  const [archiveModal, setArchiveModal] = useState(false);
  const [trashModal, setTrashModal] = useState(false); // سلّة محذوفات البطاقات
  // 🧪 نافذةُ «الخيارات» المنبثقة في تطبيق التجربة (طلب محمد 2026-08-19: «نافذة منبثقة
  //    جميله والمربعات اكبر قليلا وفوقهن اختيار المكتب بقائمة منسدلة»)
  const [trialOpts, setTrialOpts] = useState(false);
  const [achModal, setAchModal] = useState(false); // إنجازات الفنيين (للمدير)
  // ===== مرتبة الفني في تطبيقه (طلب محمد 2026-08-05) =====
  // الفني كان يعمل بلا أن يعرف أين هو من زملائه — والمسابقة بلا لوحة نتائج ليست مسابقة.
  // يرى مرتبته ونقاطه ومعدّله، وبضغطة يفتح **نفس ترتيب المكاتب كلّه** الذي يراه المكتب.
  const [myRank, setMyRank] = useState<{ rank: number; of: number; points: number; cards: number; avgMin: number | null } | null>(null);
  useEffect(() => {
    if (role !== "technician" || myTechId == null) return;
    let stop = false;
    fetch("/api/field/achievements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (stop || !d?.rows) return;
        const idx = (d.rows as { technicianId: number; points: number; cards: number; avgMin: number | null }[])
          .findIndex((x) => x.technicianId === myTechId);
        if (idx < 0) { setMyRank(null); return; }
        const me = d.rows[idx];
        setMyRank({ rank: idx + 1, of: d.rows.length, points: me.points, cards: me.cards, avgMin: me.avgMin });
      })
      .catch(() => {});
    return () => { stop = true; };
  }, [role, myTechId, cards.length]);
  const [dedModal, setDedModal] = useState(false);
  const [dedPending, setDedPending] = useState(0);
  // مواقع أعمدة أرسلها الفنيون من الأرض — بانتظار قبول المدير
  const [mapModal, setMapModal] = useState(false);
  const [mapPending, setMapPending] = useState(0);
  const [moveErr, setMoveErr] = useState(""); // فشل حفظ ترتيب سحبٍ (بطاقة أو عمود) — يُعلَن لا يُكتَم
  useEffect(() => {
    if (!moveErr) return;
    const t = setTimeout(() => setMoveErr(""), 5000);
    return () => clearTimeout(t);
  }, [moveErr]);

  const load = useCallback((office?: number | null) => {
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/board${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) {
        setBoard(d.board); setLists(d.lists); setCards(d.cards); setOdooActive(!!d.odooActive);
        setCanAddCards(d.canAddCards !== false); // المستخدم/المدير: الحقل غائب ⇒ مسموح
        setSlaOn(!!d.odooSla?.alarm);
        setSlaAlarmMin(Number(d.odooSla?.alarmMin) || SLA_ALARM_MIN_DEFAULT);
        setSlaSendMin(Number(d.odooSla?.sendMin) || SLA_SEND_MIN_DEFAULT);
        setTechnicians(d.technicians ?? []); setOffices(d.offices ?? []); setOfficePanels(d.officePanels ?? {});
        setCardTypes(d.cardTypes ?? []); setOfficeId(d.officeId ?? null);
        setIsManager(!!d.isManager); setCanManage(!!d.canManage); setRole(d.role ?? "");
        setCanOperate(d.canOperate !== false); setMyOfficeId(d.myOfficeId ?? null);
        setSupportInfo(d.supportInfo ?? null);
        setSupportOfficeId(d.supportOfficeId ?? null);
      }
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  // تذاكرُ المشتركين على مستوى الوكيل (لا المكتب) — تُجلَب مرّةً وتُحدَّث مع دورة اللوحة وبعد كلّ فعل
  const loadTickets = useCallback(() => {
    fetch("/api/field/subscriber-tickets").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && Array.isArray(d.tickets)) setSubTickets(d.tickets);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadTickets(); }, [loadTickets]);
  // طلباتُ متجر الوكيل (على مستوى الوكيل) — تُجلَب مرّةً وتُحدَّث مع دورة اللوحة وبعد كلّ فعل
  const loadStoreOrders = useCallback(() => {
    fetch("/api/field/store-orders").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && Array.isArray(d.orders)) setStoreOrders(d.orders);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadStoreOrders(); }, [loadStoreOrders]);
  // سوبر سيل مفعّلة؟ (عامّ، يعمل للفنيّ أيضاً) — لإخفاء اسمها من «مهلة أودو» عند الإطفاء
  useEffect(() => {
    fetch("/api/app/config").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setPortalOn(d.portalEnabled !== false); }).catch(() => {});
  }, []);
  async function patchTicket(id: number, status: string) {
    try {
      await fetch("/api/field/subscriber-tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      loadTickets();
    } catch { /* لا نكسر الواجهة */ }
  }
  async function patchStoreOrder(id: number, status: string) {
    try {
      await fetch("/api/field/store-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      loadStoreOrders();
    } catch { /* لا نكسر الواجهة */ }
  }
  // فصلُ التذاكر: عمودٌ لتذاكر المشتركين (من التطبيق) وآخرُ لبطاقات الشركة (source=company)
  const subOnly = subTickets.filter((t) => t.source !== "company");
  const coCards = subTickets.filter((t) => t.source === "company");

  // تحديث تلقائي كل ٢٠ ثانية (كان ٥ — حمية بولنغ: يخفّض طلبات كل جهاز فاتح للوحة ~٤ أضعاف).
  // يتوقّف مؤقتاً أثناء أي نافذة/تحرير/سحب كي لا يقاطع الكتابة، وحين تكون الشاشة مخفيّة.
  // ولا يتأخر المستخدم فعلياً: كل تفاعل (إنجاز/نقل/إضافة/إغلاق نافذة) يحدّث فوراً أصلاً،
  // والعودة للتبويب تُحدّث لحظياً عبر مستمع visibilitychange أدناه.
  useEffect(() => {
    const t = setInterval(() => {
      if (!isPageActive()) return; // مخفيّ أو متروك بلا تفاعل ٣ دقائق (حمية يقظة Azure)
      if (sel || completing || postponing || drag != null || addingTo != null) return;
      load(officeId);
      loadTickets();
      loadStoreOrders();
    }, role === "technician" ? 60000 : 20000); // الفنيّ كل 60ث (طلب محمد 2026-08-08)، المدير 20ث كما هو
    // العودة للتبويب/التطبيق ⇒ تحديث فوري (لا انتظار الدورة القادمة)
    const onVisible = () => {
      if (!isPageActive()) return;
      if (sel || completing || postponing || drag != null || addingTo != null) return;
      load(officeId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, officeId, sel, completing, postponing, drag, addingTo, role]);

  // اسم الدور الحالي (للفني: اسمه ومعرّفه) — لعرضه في الشريط السفلي وللتحويل على نفسه
  useEffect(() => { fetch("/api/field/whoami").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.name) setMyName(d.name); if (d?.technicianId != null) setMyTechId(d.technicianId); }); }, []);

  // فتح نافذة المراجعة من نقر إشعار: (1) نقرة داخل الجرس (حدث bell:open-modal)،
  // (2) نقرة إشعار الهاتف Push تفتح ?open=deductions|leaves — فيصل المدير للموافقة مباشرة
  useEffect(() => {
    if (!canManage) return;
    const openModal = (which: string) => {
      if (which === "deductions") setDedModal(true);
      else if (which === "leaves") setLeaveModal(true);
      else if (which === "map-proposals") setMapModal(true);
      else if (which === "achievements") setAchModal(true);
    };
    const onBell = (e: Event) => openModal(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("bell:open-modal", onBell);
    const q = new URLSearchParams(window.location.search).get("open");
    if (q) { openModal(q); window.history.replaceState(null, "", window.location.pathname); }
    return () => window.removeEventListener("bell:open-modal", onBell);
  }, [canManage]);

  // عدد مواقع الأعمدة المعلّقة (للمدير) — بشارة على زرّها
  const loadMapPending = useCallback(() => {
    if (!canManage) return;
    fetch("/api/field/map-proposal").then((r) => (r.ok ? r.json() : null)).then((d) => d && setMapPending(d.pending ?? 0)).catch(() => {});
  }, [canManage]);
  useEffect(() => { loadMapPending(); }, [loadMapPending]);

  // عدد طلبات الإجازة المعلّقة (للمدير) — بشارة على زر الإجازات
  const loadLeavePending = useCallback((office?: number | null) => {
    if (!canManage) return;
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/leaves${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLeavePending(d.pendingCount ?? 0));
  }, [canManage]);
  useEffect(() => { loadLeavePending(officeId); }, [loadLeavePending, officeId]);

  // عدد الخصومات المعلّقة (للمدير) — بشارة على زر الخصومات
  const loadDedPending = useCallback((office?: number | null) => {
    if (!canManage) return;
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/adjustments${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setDedPending(d.pendingCount ?? 0));
  }, [canManage]);
  useEffect(() => { loadDedPending(officeId); }, [loadDedPending, officeId]);

  // مبدّل «محسوب بالوقت» لعمود (للمدير)
  async function toggleTimeTracked(l: List) {
    const next = !l.timeTracked;
    setLists((xs) => xs.map((x) => (x.id === l.id ? { ...x, timeTracked: next } : x)));
    const r = await fetch("/api/field/lists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: l.id, timeTracked: next }) });
    if (!r.ok) setLists((xs) => xs.map((x) => (x.id === l.id ? { ...x, timeTracked: !next } : x))); // تراجع عند الفشل
  }


  const isTech = role === "technician";
  // أ-٢ · إدارةُ الأعمدة (إنشاء/تسمية/حذف/⏱) للمدير **ولمستخدم المكتب** على مكتبه المعروض —
  // والفنيُّ مستثنى (حسمه محمد 2026-08-14: «نعم يشمل الحذف أيضاً»). والخادمُ يحرس بنفس القاعدة.
  const canEditLists = canManage || (canOperate && !isTech);
  const canTrack = role !== "" && role !== "technician"; // تتبّع الفنيين للمدير/الموظف فقط
  async function techLogout() {
    await fetch("/api/field/tech-logout", { method: "POST" });
    router.replace("/login");
  }
  async function userLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  // تبديل المكتب — الموظف (غير المدير) يُؤكَّد له الانتقال لغير مكتبه (مشاهدة فقط).
  // الفني متعدد المكاتب: تبديل مباشر — كل مكاتبه المعروضة يتصرف فيها كأصلي (لا «مشاهدة»)
  function switchOffice(id: number) {
    if (id === officeId) return;
    if (!isTech && !canManage && myOfficeId != null && id !== myOfficeId) {
      const name = offices.find((o) => o.id === id)?.name ?? `مكتب ${id}`;
      if (!confirm(`ستنتقل إلى مكتب «${name}» — مشاهدة فقط بلا تعديل. متابعة؟`)) return;
    }
    setOfficeId(id); load(id);
  }

  async function createType() {
    const name = prompt("اسم نوع البطاقة الجديد:");
    if (!name?.trim()) return;
    const deliveryOnly = confirm("هل هو من نوع «التوصيل» (مبلغ فقط بلا تفاصيل عند الإنجاز)؟\nموافق = توصيل، إلغاء = صيانة (حقول كاملة)");
    const r = await fetch("/api/field/card-types", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), deliveryOnly }),
    });
    if (r.ok) { const t = await r.json(); setCardTypes((x) => (x.some((y) => y.id === t.id) ? x : [...x, t])); setCardKind(t.name); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّرت الإضافة"); }
  }

  async function addCard(listId: number) {
    if (!canOperate) return;
    const title = cardText.trim();
    if (!title) { setAddingTo(null); return; }
    const tech = technicians.find((t) => String(t.id) === cardTech);
    const payload = {
      listId, title, kind: cardKind,
      technicianId: tech?.id ?? null, assignee: tech?.name ?? null,
      dueDate: cardDue || null,
    };
    // 🔴 عالٍ · لا تُمحَ الحقولُ ولا يُبتلَع الخطأُ (اصطاده الفحصُ العدائيّ 2026-08-19):
    //   كان يُصفَّر الإدخالُ **قبل** الإرسال وبلا else ⇒ فشلٌ (جلسةٌ منتهية · عمودٌ حُذف ·
    //   منعُ صلاحيّة) يمحو نصَّ البطاقة بلا رسالة، فيضيع طلبُ العمل ويظنُّه المستخدمُ حُفظ.
    //   الآن: التصفيرُ بعد النجاح، وelse يعرض سببَ الخادم (كنمط addCardType أعلاه).
    const r = await fetch("/api/field/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) {
      const c = await r.json();
      setCards((x) => [...x, c]);
      setCardText(""); setCardTech(""); setCardDue(""); setCardKind(cardTypes[0]?.name ?? "صيانة");
    } else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّرت إضافةُ البطاقة — لم تُحفَظ، وبياناتُك باقية"); }
  }
  async function addList() {
    const name = newList.trim();
    if (!name || !board) return;
    const r = await fetch("/api/field/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardId: board.id, name }) });
    if (r.ok) { const l = await r.json(); setLists((x) => [...x, l]); setNewList(""); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّرت إضافةُ العمود — لم يُحفَظ، والاسمُ باقٍ"); }
  }
  async function renameList(l: List) {
    const name = prompt("اسم العمود:", l.name);
    if (name == null) return;
    setLists((x) => x.map((y) => (y.id === l.id ? { ...y, name } : y)));
    const r = await fetch("/api/field/lists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: l.id, name }) });
    // فشلٌ (مشاهدةٌ فقط · جلسة) ⇒ تراجعٌ بإعادة التحميل من الخادم (مصدرُ الحقيقة) + رسالة
    if (!r.ok) { const d = await r.json().catch(() => ({})); load(officeId); alert(d.error ?? "تعذّرت إعادةُ التسمية"); }
  }
  async function deleteList(l: List) {
    if (!confirm(`حذف العمود «${l.name}» وكل بطاقاته؟`)) return;
    setLists((x) => x.filter((y) => y.id !== l.id));
    setCards((x) => x.filter((c) => c.listId !== l.id));
    const r = await fetch(`/api/field/lists?id=${l.id}`, { method: "DELETE" });
    // 🔴 عالٍ · كان الحذفُ متفائلاً بلا فحص: فشلٌ (مشاهدةٌ فقط) يُخفي العمودَ من الشاشة
    //   وهو باقٍ في الخادم فيعود بأوّل تحديث. الآن: تراجعٌ بإعادة التحميل + رسالة.
    if (!r.ok) { const d = await r.json().catch(() => ({})); load(officeId); alert(d.error ?? "تعذّر حذفُ العمود — ما زال قائماً"); }
  }
  // ===== محرّك السحب (لمس وفأرة بواجهة Pointer واحدة) =====
  const DRAG_HOLD_MS = 200; // ما دونه سحبٌ عرضي، وما فوقه انتظارٌ ثقيل
  const DRAG_SLOP = 10; // حركة قبل انطلاق السحب ⇒ تمريرُ شاشة لا سحب
  const CARD_GAP = 8; // فراغ space-y-2 بين البطاقات

  const applyDrag = useCallback((d: DragCard | DragList | null) => { dragRef.current = d; setDrag(d); }, []);

  function pressStart(e: React.PointerEvent, kind: "card" | "list", id: number) {
    if (!canOperate || isTech) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const sel = kind === "card" ? "[data-card-id]" : "[data-list-id]";
    const el = (e.target as HTMLElement).closest(sel) as HTMLElement | null;
    if (!el) return;
    const mouse = e.pointerType === "mouse";
    if (mouse) e.preventDefault(); // وإلّا بدأ تحديدُ النصّ مع أوّل حركةِ سحبٍ فوريّ
    pendRef.current = { kind, id, x: e.clientX, y: e.clientY, el, mouse };
    if (pressTimer.current) clearTimeout(pressTimer.current);
    // أ-٤ · الفأرةُ بلا مؤقّت: السحبُ ينطلق من أوّل حركةٍ (في مُعالِج pointermove) — والنقرةُ
    // الساكنةُ تبقى نقرةً تفتح البطاقة. واللمسُ على مؤقّته كي لا يتعطّل تمريرُ الشاشة.
    if (!mouse) pressTimer.current = setTimeout(startDrag, DRAG_HOLD_MS);
  }
  function cancelPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    pendRef.current = null;
  }
  function startDrag() {
    const p = pendRef.current;
    if (!p) return;
    const r = p.el.getBoundingClientRect();
    const base = { id: p.id, w: r.width, h: r.height, offX: p.x - r.left, offY: p.y - r.top, x: p.x, y: p.y };
    if (p.kind === "card") {
      const c = cards.find((x) => x.id === p.id);
      if (!c) return;
      const idx = cards.filter((x) => x.listId === c.listId && !x.done).sort((a, b) => a.position - b.position).findIndex((x) => x.id === c.id);
      applyDrag({ kind: "card", ...base, fromList: c.listId, toList: c.listId, index: Math.max(0, idx) });
    } else {
      const idx = [...lists].sort((a, b) => a.position - b.position).findIndex((x) => x.id === p.id);
      applyDrag({ kind: "list", ...base, index: Math.max(0, idx) });
    }
    try { navigator.vibrate?.(12); } catch { /* الاهتزاز رفاهية */ }
  }

  // أين سيقع؟ العمود من تحت الإصبع، والموضع بمقارنة الإصبع بمنتصف كل بطاقة
  function cardTargetAt(x: number, y: number, d: DragCard): { listId: number; index: number } {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const listEl = el?.closest("[data-list-id]") as HTMLElement | null;
    const listId = Number(listEl?.dataset.listId) || d.toList;
    const nodes = listEl ? (Array.from(listEl.querySelectorAll("[data-card-id]")) as HTMLElement[]) : [];
    const others = nodes.filter((n) => Number(n.dataset.cardId) !== d.id);
    let index = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { index = i; break; }
    }
    return { listId, index };
  }
  // الأعمدة من اليمين لليسار (RTL): الإفلات يمين منتصف عمودٍ يعني قبله
  function listTargetAt(x: number, d: DragList): number {
    const nodes = Array.from(document.querySelectorAll("[data-list-id]")) as HTMLElement[];
    const others = nodes.filter((n) => Number(n.dataset.listId) !== d.id);
    let index = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (x > r.left + r.width / 2) { index = i; break; }
    }
    return index;
  }
  // تمرير اللوحة أفقياً حين يقترب الإصبع من حافّتها (وإلا تعذّر النقل لعمودٍ خارج الشاشة)
  function autoScroll(x: number) {
    const el = boardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (x < r.left + 70) el.scrollLeft -= 20;
    else if (x > r.right - 70) el.scrollLeft += 20;
  }


  // ===== لا حفظَ صامتاً للسحب (مع فتح تحريك الأعمدة للمستخدم) =====
  // كانت نتائج طلبات الترتيب تُرمى بـ`catch` فارغ، فلو رُدّ الطلب (٤٠٣ على مكتبٍ آخر مثلاً)
  // بقي الترتيب الجديد على الشاشة بلا حفظ ⇒ «سحبٌ وهميّ» يعود عند أوّل تحديث بلا تفسير.
  // الآن: يُعلَن سبب الردّ، ويُعاد تحميل اللوحة ليظهر الواقع فوراً لا بعد دقيقة.
  async function savePositions(reqs: Promise<Response>[]) {
    const res = await Promise.allSettled(reqs);
    const bad = res.find((x) => x.status === "rejected" || !x.value.ok);
    if (!bad) return;
    let m = "تعذّر حفظ الترتيب — تحقّق من الاتصال";
    if (bad.status === "fulfilled") {
      const d = await bad.value.json().catch(() => null);
      if (d?.error) m = String(d.error);
    }
    setMoveErr(m);
    load(officeId); // إرجاع الترتيب الحقيقيّ من الخادم
  }

  // إزاحة البطاقات لفتح المكان — بـtransform وحده: سلسٌ بلا إعادة تخطيط
  function cardShift(listId: number, visIndex: number): number {
    const d = drag;
    if (!d || d.kind !== "card" || d.toList !== listId) return 0;
    return visIndex >= d.index ? d.h + CARD_GAP : 0;
  }

  // تثبيت إفلات البطاقة: ترتيب العمود الهدف كاملاً (والانتقال بين الأعمدة إن حصل)
  async function commitCard(d: DragCard) {
    const card = cards.find((c) => c.id === d.id);
    if (!card) return;
    const rest = cards.filter((c) => c.listId === d.toList && !c.done && c.id !== d.id).sort((a, b) => a.position - b.position);
    const idx = Math.max(0, Math.min(d.index, rest.length));
    const wasIdx = cards.filter((c) => c.listId === d.fromList && !c.done).sort((a, b) => a.position - b.position).findIndex((c) => c.id === d.id);
    if (d.toList === d.fromList && idx === wasIdx) return; // لم يتغيّر شيء
    const arr = [...rest.slice(0, idx), { ...card, listId: d.toList }, ...rest.slice(idx)];
    const posById = new Map(arr.map((x, i) => [x.id, i]));
    setCards((x) => x.map((c) => {
      if (c.id === d.id) return { ...c, listId: d.toList, position: posById.get(c.id) ?? 0 };
      return posById.has(c.id) ? { ...c, position: posById.get(c.id)! } : c;
    }));
    if (sel?.id === d.id && d.toList !== d.fromList) setSel({ ...sel, listId: d.toList });
    await savePositions(arr.map((x, i) =>
      fetch("/api/field/cards", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(x.id === d.id ? { id: x.id, listId: d.toList, position: i } : { id: x.id, position: i }),
      }),
    ));
  }

  // تثبيت إفلات العمود في موضعه الجديد
  async function commitList(d: DragList) {
    const arr = [...lists].sort((a, b) => a.position - b.position);
    const fi = arr.findIndex((x) => x.id === d.id);
    if (fi < 0) return;
    const [moved] = arr.splice(fi, 1);
    const idx = Math.max(0, Math.min(d.index, arr.length));
    if (idx === fi) return;
    arr.splice(idx, 0, moved);
    const next = arr.map((x, i) => ({ ...x, position: i }));
    setLists(next);
    await savePositions(next.map((x) =>
      fetch("/api/field/lists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: x.id, position: x.position }) }),
    ));
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) {
        const p = pendRef.current;
        if (p && (Math.abs(e.clientX - p.x) > DRAG_SLOP || Math.abs(e.clientY - p.y) > DRAG_SLOP)) {
          // أ-٤ · الفأرة: الحركةُ نفسُها تُطلق السحبَ فوراً (لا تمريرَ شاشةٍ بالفأرة يُخشى عليه).
          // واللمس: الحركةُ قبل المؤقّت تعني تمريرَ شاشةٍ ⇒ يُلغى الانتظار كما كان.
          if (p.mouse) startDrag();
          else cancelPress();
        }
        return;
      }
      e.preventDefault();
      if (d.kind === "card") {
        const t = cardTargetAt(e.clientX, e.clientY, d);
        applyDrag({ ...d, x: e.clientX, y: e.clientY, toList: t.listId, index: t.index });
      } else {
        applyDrag({ ...d, x: e.clientX, y: e.clientY, index: listTargetAt(e.clientX, d) });
      }
      autoScroll(e.clientX);
    };
    const up = () => {
      cancelPress();
      const d = dragRef.current;
      if (!d) return;
      applyDrag(null);
      draggedAt.current = Date.now();
      if (d.kind === "card") void commitCard(d);
      else void commitList(d);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  async function moveCard(card: Card, toListId: number) {
    if (!canOperate) return;
    if (card.listId === toListId) return;
    const pos = cards.filter((c) => c.listId === toListId).length;
    setCards((x) => x.map((c) => (c.id === card.id ? { ...c, listId: toListId, position: pos } : c)));
    if (sel?.id === card.id) setSel({ ...sel, listId: toListId });
    await fetch("/api/field/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: card.id, listId: toListId, position: pos }) });
  }
  async function saveCard(patch: Partial<Card>) {
    if (!sel || !canOperate) return;
    const prev = sel; // للتراجع إن رفض الخادم
    const merged = { ...sel, ...patch };
    setSel(merged);
    setCards((x) => x.map((c) => (c.id === sel.id ? merged : c)));
    const r = await fetch("/api/field/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel.id, ...patch }) }).catch(() => null);
    if (!r || !r.ok) {
      // تراجُع: لا نُبقي على الشاشة تغييراً لم يُحفَظ (كان يحدث بصمت فيظنّه المستخدم منفَّذاً)
      setSel(prev);
      setCards((x) => x.map((c) => (c.id === prev.id ? prev : c)));
      const d = r ? await r.json().catch(() => ({})) : {};
      alert((d as { error?: string }).error ?? "تعذّر حفظ التعديل");
      return;
    }
    // اعكس ما حفظه الخادم فعلاً (قد ينقل البطاقة لعمود فئتها الجديدة تلقائياً)
    const saved = (await r.json().catch(() => null)) as Card | null;
    if (saved?.id) {
      setSel(saved);
      setCards((x) => x.map((c) => (c.id === saved.id ? saved : c)));
    }
  }
  async function startCard() {
    if (!sel || !canOperate) return;
    const wasVirtual = sel.listId === -1; // بطاقة عمود «دعم مؤقت» الافتراضي — تبقى فيه بعد البدء
    const r = await fetch("/api/field/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id }) });
    if (r.ok) { const c = await r.json(); if (wasVirtual) c.listId = -1; setSel(c); setCards((x) => x.map((y) => (y.id === c.id ? c : y))); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر البدء"); }
  }
  // «الغاء»: ملاحظة إلزامية، والبطاقة تنتقل لعمود «الغاء» (خارج التحصيل ولا تحجب بطاقة جديدة)
  async function cancelCard() {
    if (!sel) return;
    const raw = window.prompt("سبب الإلغاء (إلزامي — لا يتم الإلغاء بدونه):");
    if (raw === null) return; // تراجع المستخدم
    const note = raw.trim();
    if (!note) { alert("لم يُلغَ شيء — الملاحظة إلزامية."); return; }
    const r = await fetch("/api/field/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id, note }) });
    const d = await r.json().catch(() => null);
    if (!r.ok) { alert(d?.error ?? "تعذّر الإلغاء"); return; }
    setSel(null);
    await load();
  }

  // «ميجاوب»: اتصل الفني ولم يجب المشترك — البطاقة تبقى بمكانها، تُرسل رسالة
  // واتساب لطيفة للمشترك، ويتحرّر قفل «البدء» ليعمل الفني على بطاقة أخرى
  async function noAnswerCard() {
    if (!sel || !canOperate) return;
    if (!confirm("«ميجاوب»: ستبقى البطاقة بمكانها وتُرسل رسالة للمشترك أننا اتصلنا ولم يجب. متابعة؟")) return;
    const r = await fetch("/api/field/no-answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      alert(d.messaged ? "✓ أُرسلت رسالة «اتصلنا ولم تجب» للمشترك" : "سُجّلت المحاولة — تعذّر إرسال الرسالة (لا هاتف/واتساب)");
      setSel(null); load(officeId);
    } else alert(d.error ?? "تعذّرت العملية");
  }
  async function deleteCard() {
    if (!sel || !canOperate) return;
    // تحذير بالمبلغ: حذف بطاقة منجزة لم تُحصَّل يُسقط مبلغها من تحصيل الفني، بينما
    // تبقى فاتورتها وقبضها في التقارير — وكان يقع بصمت (المرحلة ٨).
    // بطاقات اللوحة غير محصّلة بطبيعتها (المحصَّلة تُؤرشَف وتختفي)، والخادم يتحقق
    // من ذلك مرّة أخرى قبل تسجيل القيد
    const pending = sel.done ? (sel.amount ?? 0) + (sel.subAmount ?? 0) : 0;
    const msg = pending > 0
      ? `حذف هذه البطاقة؟\n\n⚠️ هي منجزة ولم تُحصَّل — سينقص تحصيل ${sel.assignee ?? "الفني"} بمقدار ${pending.toLocaleString("en-US")} د.ع، وتبقى فاتورتها وقبضها في التقارير.`
      : "حذف هذه البطاقة؟";
    if (!confirm(msg)) return;
    const removed = sel; // للتراجع إن فشل الحذف
    setCards((x) => x.filter((c) => c.id !== sel.id));
    const id = sel.id; setSel(null);
    // 🔴 عالٍ · كان الحذفُ متفائلاً بلا فحص: التأكيدُ يُحذّر من إنقاصِ تحصيلِ الفنيّ، ثمّ
    //   يفشل الحذفُ (جلسةٌ · مشاهدةٌ فقط) فتختفي البطاقةُ من الشاشة وهي باقيةٌ في الخادم —
    //   فيبني المديرُ قرارَه على تحصيلٍ لم يتغيّر. الآن: تراجعٌ بإعادة التحميل + رسالة.
    const r = await fetch(`/api/field/cards?id=${id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); load(officeId); alert(d.error ?? `تعذّر حذفُ البطاقة «${removed.title}» — ما زالت قائمةً والتحصيلُ لم يتغيّر`); }
  }

  async function archiveCard() {
    if (!sel || !canOperate) return;
    if (!confirm("أرشفة هذه البطاقة؟ ستذهب إلى الأرشيف ويمكن استرجاعها.")) return;
    const removed = sel;
    setCards((x) => x.filter((c) => c.id !== sel.id));
    const id = sel.id; setSel(null);
    const r = await fetch("/api/field/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); load(officeId); alert(d.error ?? `تعذّرت أرشفةُ البطاقة «${removed.title}»`); }
  }
  // ↩️ إلغاء إنجاز بطاقة لم تُحصَّل: تعود للانتظار في عمودها، ويسقط مبلغها من تحصيل
  // الفني ومن عدّ بطاقاته في كشف الراتب. أمّا فاتورة مبيعها وقبضها فيبقيان — فالمال
  // سُجّل لحظة الإنجاز، وإلغاؤه هنا لا يعكسه (وهذا يُقال صراحةً قبل التأكيد).
  async function undoDone() {
    if (!sel || !canOperate) return;
    const back = (sel.amount ?? 0) + (sel.subAmount ?? 0);
    const msg =
      `إلغاء إنجاز «${sel.title}»؟\n\n` +
      `• تعود للانتظار في عمودها ويُطلب «بدء» من جديد.\n` +
      (back > 0 ? `• ينقص تحصيل ${sel.assignee ?? "الفني"} بمقدار ${back.toLocaleString("en-US")} د.ع.\n` : "") +
      `• فاتورة المبيع وقبضها **يبقيان** — والمواد المباعة لا تعود لذمّة الفني.`;
    if (!confirm(msg)) return;
    const id = sel.id;
    const r = await fetch("/api/field/cards", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done: false }), // التنظيف كلّه في الخادم
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر إلغاء الإنجاز"); return; }
    setSel(null); load(officeId);
  }
  // الفني يحوّل بطاقةً على نفسه (كانت على فنيٍّ آخر في نفس مكتبه)
  async function claimCard() {
    if (!sel || myTechId == null) return;
    if (!confirm(`تحويل بطاقة «${sel.title}» عليك؟ ستصبح مسؤولاً عنها بدل ${sel.assignee ?? "الفني الحالي"}.`)) return;
    const r = await fetch("/api/field/claim-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.card) {
      const c = { ...sel, technicianId: d.card.technicianId, assignee: d.card.assignee };
      setSel(c); setCards((x) => x.map((y) => (y.id === c.id ? c : y)));
    } else alert(d.error ?? "تعذّر التحويل");
  }

  const isDeliveryKind = (name: string) => cardTypes.find((t) => t.name === name)?.deliveryOnly ?? name === "توصيل";

  // ألوان الأنواع (يغيّرها المدير من «الأنواع والأوقات») — رؤوس الأعمدة وشارات النوع بالمتصفح
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (isTech) return;
    fetch("/api/field/type-colors").then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.colors) setTypeColors(d.colors); }).catch(() => {});
  }, [isTech]);
  async function setTypeColor(name: string, color: string) {
    setTypeColors((m) => ({ ...m, [name]: color }));
    await fetch("/api/field/type-colors", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color }) }).catch(() => {});
  }
  // لون رأس العمود: لون النوع المخصّص إن وُجد (مطابقة بالاحتواء) وإلا الافتراضي
  const catColorOf = (name: string): string => {
    const hit = Object.keys(typeColors).find((k) => name === k || name.includes(k));
    return hit ? typeColors[hit] : listCatColor(name);
  };

  if (loading) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  return (
    <FieldTrackerProvider enabled={canTrack}>
    <div data-app-fullheight className={`field-canvas ${isTech ? "" : "nst field-site"} flex h-[calc(100dvh-52px)] flex-col md:h-screen`}>
      {/* حركة السحب: انطواء سلّة البطاقة المحمولة، وارتفاع النسخة الطائرة تحت الإصبع */}
      <style>{`
        @keyframes fmCollapse { from { height: var(--fm-h); opacity: .45 } to { height: 0; opacity: 0 } }
        .fm-collapsing { overflow: hidden; padding-top: 0 !important; padding-bottom: 0 !important; pointer-events: none;
          animation: fmCollapse .16s cubic-bezier(.2,.8,.2,1) forwards; }
        @keyframes fmLift { from { transform: scale(1) rotate(0deg) } to { transform: scale(1.05) rotate(2deg) } }
        .fm-lift { animation: fmLift .16s cubic-bezier(.2,.8,.2,1) forwards; transform-origin: 50% 50%; }
        /* ⏳ مهلة سوبر سيل: البطاقة تتوهّج وتخفت حتى يُتّخذ إجراء (إنجاز/إلغاء/تأجيل) */
        @keyframes slaGlow {
          0%,100% { box-shadow: 0 0 0 2px rgba(220,38,38,.9), 0 0 12px 2px rgba(220,38,38,.35) }
          50%     { box-shadow: 0 0 0 2px rgba(220,38,38,.3), 0 0 3px 0 rgba(220,38,38,.1) }
        }
        .sla-card { animation: slaGlow 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .sla-card { animation: none; box-shadow: 0 0 0 2px rgba(220,38,38,.9) } }
      `}</style>
      {/* فشل حفظ ترتيب السحب — يُعلَن ولا يُكتَم (والترتيب الحقيقيّ يُعاد من الخادم) */}
      {moveErr && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[96] flex justify-center px-3">
          <div className="pointer-events-auto max-w-md rounded-lg bg-rose-600 px-3 py-2 text-center text-[13px] font-semibold text-white shadow-lg">
            {moveErr}
          </div>
        </div>
      )}
      {/* النسخة الطائرة: ما تحمله ظاهرٌ تحت إصبعك حتى تُفلته */}
      {drag && (() => {
        const c = drag.kind === "card" ? cards.find((x) => x.id === drag.id) : null;
        const l = drag.kind === "list" ? lists.find((x) => x.id === drag.id) : null;
        return (
          <div
            className="pointer-events-none fixed z-[95] select-none"
            // أ-٤ · «المسحوب يصير شفافاً قليلاً أثناء السحب» — فتُرى الأعمدةُ والبطاقات من خلفه
            style={{ left: 0, top: 0, width: drag.w, opacity: .8, transform: `translate3d(${drag.x - drag.offX}px, ${drag.y - drag.offY}px, 0)` }}
          >
            <div className="fm-lift">
              {c && (
                <div className="rounded-lg bg-white p-2.5 shadow-2xl ring-2 ring-sky-400/70">
                  <div className="text-sm font-medium text-slate-800">{c.title}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded px-1.5 py-0.5 font-semibold text-white" style={{ background: catColorOf(lists.find((x) => x.id === (drag.kind === "card" ? drag.toList : -1))?.name ?? "") }}>{c.kind}</span>
                    {c.assignee && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">👤 {c.assignee}</span>}
                  </div>
                </div>
              )}
              {l && (
                <div className="rounded-xl border border-line bg-surface-2 shadow-2xl ring-2 ring-sky-400/70">
                  <div className="rounded-t-[11px] px-3 py-2 font-bold text-white" style={{ background: catColorOf(l.name ?? "") }}>
                    {l.name} <span className="text-xs font-normal text-white/75">({cards.filter((x) => x.listId === l.id && !x.done).length})</span>
                  </div>
                  <div className="px-3 py-3 text-center text-xs text-slate-400">— أفلته في مكانه الجديد —</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {/* ترويسة اللوحة */}
      <div data-app-safetop className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className={`flex items-center gap-2 ${isTech ? "text-white" : "text-ink"}`}>
          <span className="text-xl">🛠️</span>
          <div className="leading-tight">
            <h1 className="text-lg font-bold">إدارة الفنيين</h1>
            {offices.length > 0 && officeId != null && (
              <div data-app-only className="text-[11px] font-medium text-white/70">🏢 {offices.find((o) => o.id === officeId)?.name ?? `مكتب ${officeId}`}</div>
            )}
          </div>
          {/* ربط أودو — بجانب العنوان (للمدير والمستخدم، لا للفني)؛ شارة مفعّل أخضر/غير مفعّل أحمر */}
          {/* أ-٢٣ · مكتبٌ بلوحتَي ساس ⇒ **زرُّ أودو لكلّ لوحةٍ جنباً إلى جنب** (طلبُ محمد:
              «رابطان لأودو بدل واحد — الأوّلُ في مكانه الحاليّ والآخرُ بجانبه مباشرةً»)، ولكلٍّ
              بوّابتُه وحسابُه وشارتُه. ومكتبُ اللوحةِ الواحدةِ ⇒ **زرٌّ واحدٌ كما هو اليوم بالضبط**
              (فـ`officePanels` لا يأتي من الخادم إلّا لمكتبِ التعدّد). */}
          {!isTech && officeId != null && (
            <span data-trial-hide className="contents">
            {(officePanels[officeId]?.length ?? 0) > 1
              ? officePanels[officeId].map((p, i) => (
                  <OdooConfigButton
                    key={p.id}
                    officeId={officeId}
                    panelId={p.id}
                    officeName={`${offices.find((o) => o.id === officeId)?.name ?? "المكتب"} · ${p.label || `لوحة ${i + 1}`}`}
                    onChange={() => load(officeId)}
                  />
                ))
              : <OdooConfigButton officeId={officeId} officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"} onChange={() => load(officeId)} />}
            </span>
          )}
          {/* 📤 مراسلةُ سوبر سيل (وارد الوكلاء — جانبُ الوكيل) — لصاحب صلاحية إدارة الفنيين */}
          <span data-trial-hide className="contents"><AgentCompanyOutbox canManage={canManage} /></span>
        </div>
        <div className="flex items-center gap-2">
          {/* 🧪 في التجربة ينزل الجرسُ إلى الركن الأيمن السفليّ بجانب «الخيارات»
              (trial-dock-bell — شفّافةٌ contents في المتصفّح) */}
          <span data-trial-hide className="contents">{canManage && <NotificationsBell />}</span>
          {isTech ? (
            <button onClick={techLogout} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">خروج ⏻</button>
          ) : (
            <>
              {/* المتصفح: زر الرئيسية · التطبيق: زر خروج (تبديل عبر CSS بلا وميض)
                  🧪 وكلاهما يُحذف في التجربة (طلب محمد: موجودان في القائمة الجانبيّة) */}
              <button data-site-only data-trial-hide onClick={() => router.push("/dashboard")} className="back">← الرئيسية</button>
              <button data-app-only data-trial-hide onClick={userLogout} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">خروج ⏻</button>
            </>
          )}
        </div>
      </div>

      {/* شريط الأدوات العلوي (طراز المدير بالمتصفح): كان أسفل وسط الشاشة — رُفع للأعلى
          بكل خياراته، بلون خلفية الصفحة وبلا أزرار ملوّنة (تصميم النموذج).
          لوحة الفني بالمتصفح تُبقي شريطها السفلي القديم كما هو حرفياً. */}
      {/* 🧪 data-app-bar: في تطبيق التجربة ينزل هذا الشريطُ كلُّه (المكاتبُ والقائمتان)
          إلى ورقة «الخيارات» المطويّة أسفل الشاشة — فيصفو رأسُ الصفحة كنموذج (د).
          بلاغ محمد 2026-08-19: «صفحة الفنيين تظهر بكثير من الازرار للمدير» */}
      {!isTech && offices.length > 0 && (
        <div data-site-only data-trial-hide className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          {offices.map((o) => (
            <button
              key={o.id}
              onClick={() => switchOffice(o.id)}
              className={officeId === o.id
                ? "rounded-lg bg-navy px-3.5 py-1.5 text-sm font-bold text-white shadow"
                : "rounded-lg border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-2 transition hover:border-orange hover:text-orange-d"}
            >
              {o.name ?? `مكتب ${o.id}`}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {/* ═════ البند ١٠ · قوائمُ منسدلةٌ بدل صفٍّ من تسعة أزرار (طلبُ محمد 2026-08-14) ═════
              بنصّه: «كثرت الأزرارُ للقائمة العلويّة جدّاً ⇒ قوائمُ منسدلةٌ ٢ أو ٣ مجموعات
              بحسب كلّ فئةٍ واختصاص، وعنوانُ القائمة يخصّ ما بداخلها».
              ⇒ مجموعتان بحسب **الاختصاص**: «شؤون الفنيّين» (مَن يعمل ومتى وماله)
                و«اللوحة والسجلّات» (إعدادُ العمل وأرشيفُه).
              🔑 **والشاراتُ تصعد إلى عنوان المجموعة**: إجازةٌ أو خصمٌ معلَّقٌ داخل قائمةٍ
                 مطويّةٍ = شارةٌ لا تُرى ⇒ «المديرُ لم ينتبه» — وهي بعينها شكوى محمد في
                 بند الإجازة الزمنيّة (الحالة ٤). فمجموعُ المعلَّقات يظهر على العنوان. */}
          {(canManage || canOperate) && (
            <div data-trial-hide className="contents">
            <FieldMenu title="شؤون الفنيّين" badge={canManage ? leavePending + dedPending : 0}>
              <FieldMenuItem onClick={() => setTechModal(true)}>👷 الفنيون ({technicians.length})</FieldMenuItem>
              {canManage && (
                <FieldMenuItem onClick={() => setLeaveModal(true)} badge={leavePending}>📅 الإجازات</FieldMenuItem>
              )}
              {canManage && (
                <FieldMenuItem onClick={() => setDedModal(true)} badge={dedPending}>💠 الخصومات</FieldMenuItem>
              )}
              {/* إنجازات الفنيين: في شريط التطبيق أيضاً — كان في ترويسة المتصفّح وحدها فلا يراه
                  المدير من هاتفه (تصحيح 2026-08-05) */}
              {canManage && <FieldMenuItem onClick={() => setAchModal(true)}>🏅 إنجازات الفنيين</FieldMenuItem>}
              {officeId != null && <FieldMenuItem onClick={() => setSupportModal(true)}>🤝 دعم مؤقت</FieldMenuItem>}
              {/* البند ٨ · كلمةٌ واضحةٌ (لا رمزٌ وحدَه) وللمدير فقط. ورمزٌ صغيرٌ كبقيّة
                  العناصر بطلب محمد 2026-08-14 — فالرمزُ زيادةٌ على الكلمة لا بديلٌ عنها. */}
              {canManage && !isTech && (
                <FieldMenuItem href="/attendance">🕒 حضور الفنيين</FieldMenuItem>
              )}
            </FieldMenu>
            </div>
          )}
          <div data-trial-hide className="contents">
          <FieldMenu title="اللوحة والسجلّات" badge={canManage ? mapPending : 0}>
            {canManage && <FieldMenuItem onClick={() => setTypesModal(true)}>⏱ الأنواع والأوقات</FieldMenuItem>}
            {/* 📍 **بلاغُ محمد 2026-08-24**: «الإشعارُ يظهر ولا يمكن الضغط عليه» — ولم يكن
                للمدير مدخلٌ آخرُ أصلاً: زرُّ مواقع الأعمدة وُلد (e351189) **داخل شريط
                الفنيّين** الذي حُصر بـ`isTech` قبله بستّة أيّام (fac5250)، وشرطُه `canManage`
                — وهما لا يجتمعان أبداً، فلم يُعرَض لمديرٍ يوماً. ومكانُه الصحيح هنا. */}
            {canManage && <FieldMenuItem onClick={() => setMapModal(true)} badge={mapPending}>📍 مواقع الأعمدة</FieldMenuItem>}
            <FieldMenuItem onClick={() => setArchiveModal(true)}>🗂️ الأرشيف</FieldMenuItem>
            {canOperate && !isTech && <FieldMenuItem onClick={() => setTrashModal(true)}>🗑️ المحذوفة</FieldMenuItem>}
          </FieldMenu>
          </div>
        </div>
      )}

      {/* شريط دعم اليوم الكامل: لوحة الفني مقلوبة لمكتب الدعم حتى إنهائه */}
      {supportInfo && (
        <div className="mx-4 mb-2 rounded-lg bg-amber-400/90 px-3 py-2 text-center text-sm font-bold text-amber-950 shadow">
          {supportInfo}
        </div>
      )}

      {/* صف: اللوحة (يمين) + لوحة خريطة التتبّع الجانبية (يسار، سطح المكتب — تحجز مكانها) */}
      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
      {/* الأعمدة */}
      <div
        ref={boardRef}
        data-app-board
        data-empty={lists.length === 0 ? "1" : undefined}
        style={drag ? { touchAction: "none" } : undefined}
        className="flex min-w-0 flex-1 items-start gap-3 overflow-x-auto"
      >
        {/* حالة فارغة أنيقة (تظهر داخل التطبيق فقط عبر CSS) */}
        {lists.length === 0 && (
          <div data-app-only>
            <div className="flex flex-col items-center gap-3 text-center text-white/85">
              <div className="text-6xl">🗂️</div>
              <div className="text-lg font-bold">لا أعمدة بعد</div>
              <div className="max-w-[240px] text-sm text-white/60">{canEditLists ? "أضِف أول عمود لتبدأ بتنظيم بطاقات الفنيين" : "لم يُنشئ المدير أعمدة لهذا المكتب بعد"}</div>
            </div>
          </div>
        )}
        {/* 🎫 عمودُ تذاكر المشتركين: طلباتُ اشتراكٍ جديدةٌ من التطبيق مُوجَّهةٌ لهذا الوكيل بأقرب عامود.
            على مستوى الوكيل (يظهر على كلّ مكاتبه)؛ يُخفى إن لا تذاكر أو إن وجّهها المالكُ لسوبر سيل فقط. */}
        {subOnly.length > 0 && (
          <div data-app-col className="flex max-h-full w-[280px] shrink-0 flex-col rounded-xl border border-line bg-surface-2 shadow-lg">
            <div className="flex items-center justify-between rounded-t-[11px] bg-emerald-600 px-3 py-2 text-white">
              <span className="text-sm font-bold">🎫 تذاكر المشتركين</span>
              <span className="rounded-full bg-white/25 px-2 text-xs font-bold">{subOnly.filter((t) => t.status === "new").length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {subOnly.map((t) => {
                const dist = t.poleDistanceM == null ? null : t.poleDistanceM >= 1000 ? `${(t.poleDistanceM / 1000).toFixed(1)}كم` : `${t.poleDistanceM}م`;
                const done = t.status === "done", rej = t.status === "rejected";
                return (
                  <div key={t.id} className={`rounded-lg bg-white p-2.5 shadow-sm ${done ? "opacity-60" : rej ? "opacity-50" : ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-slate-800">{t.name}</span>
                        {t.type && <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ background: t.type === "صيانة" ? "#d97706" : t.type === "توصيل" ? "#2563eb" : "#059669" }}>{t.type === "صيانة" ? "🔧 صيانة" : t.type === "توصيل" ? "🚚 توصيل" : "🆕 اشتراك"}</span>}
                      </div>
                      {t.status !== "new" && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${done ? "bg-emerald-100 text-emerald-700" : rej ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{t.status === "contacted" ? "تواصلت" : done ? "أُنجز" : "رُفض"}</span>}
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500"><CallPhone phone={t.phone} /></div>
                    {t.area && <div className="mt-1 text-[11px] text-slate-600">🗺️ {t.area}</div>}
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t.nearestPole ? <>📍 {t.nearestPole}{dist ? ` · يبعد ${dist}` : ""}</> : "📍 بلا موقع"}
                    </div>
                    {t.lat != null && t.lng != null && (
                      <a href={`https://www.google.com/maps?q=${t.lat},${t.lng}`} target="_blank" rel="noopener noreferrer"
                        className="mt-1 inline-block rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-100">🧭 موقع التنصيب</a>
                    )}
                    {t.note && <div className="mt-1 rounded bg-slate-50 p-1.5 text-[11px] text-slate-600">{t.note}</div>}
                    {canManage && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {t.status !== "contacted" && !done && !rej && <button onClick={() => void patchTicket(t.id, "contacted")} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">تواصلت</button>}
                        {!done && <button onClick={() => void patchTicket(t.id, "done")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200">✓ أُنجز</button>}
                        {!rej && <button onClick={() => void patchTicket(t.id, "rejected")} className="rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">✕ رفض</button>}
                        {(done || rej) && <button onClick={() => void patchTicket(t.id, "new")} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">↩ إرجاع</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 🏬 عمودُ طلبات المتجر: طلباتُ توصيلٍ من متجر الوكيل — يظهر حين تأتيه طلبات فقط (طلب محمد) */}
        {storeOrders.length > 0 && (
          <div data-app-col className="flex max-h-full w-[280px] shrink-0 flex-col rounded-xl border border-line bg-surface-2 shadow-lg">
            <div className="flex items-center justify-between rounded-t-[11px] bg-[#0d7d94] px-3 py-2 text-white">
              <span className="text-sm font-bold">🏬 طلبات المتجر</span>
              <span className="rounded-full bg-white/25 px-2 text-xs font-bold">{storeOrders.filter((o) => o.status === "new").length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {storeOrders.map((o) => {
                const accepted = o.status === "accepted";
                return (
                  <div key={o.id} className="rounded-lg bg-white p-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-1">
                      <span className="min-w-0 truncate text-sm font-bold text-slate-800">{o.lines.length > 1 ? `🛒 ${o.lines.length} مواد` : `${o.lines[0]?.productTitle ?? o.productTitle}${(o.lines[0]?.qty ?? o.qty) > 1 ? ` × ${o.lines[0]?.qty ?? o.qty}` : ""}`}</span>
                      {accepted && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">مقبول</span>}
                    </div>
                    {o.lines.length > 1 && <div className="mt-1 space-y-0.5">{o.lines.map((l, idx) => <div key={idx} className="text-[11px] text-slate-600">• {l.productTitle} × {l.qty}</div>)}</div>}
                    {(o.total ?? o.price) != null && <div className="mt-0.5 text-xs font-bold text-[#0d7d94]">الإجمالي {(o.total ?? o.price)!.toLocaleString("en-US")} د.ع</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                      <span className={`rounded px-1.5 py-0.5 font-bold ${o.fulfillment === "delivery_install" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>{o.fulfillment === "delivery_install" ? "🚚🔧 توصيل وتنصيب" : "🚚 توصيل"}</span>
                      {o.deliveryFee != null && <span className="text-slate-500">توصيل {o.deliveryFee.toLocaleString("en-US")}</span>}
                      {o.installFee != null && <span className="text-slate-500">· تنصيب {o.installFee.toLocaleString("en-US")}</span>}
                    </div>
                    {o.subscriberName && <div className="mt-0.5 text-[11px] font-semibold text-slate-600">{o.subscriberName}</div>}
                    <div className="mt-0.5 text-xs font-semibold text-slate-500"><CallPhone phone={o.phone} /></div>
                    <div className="mt-1 text-[11px] text-slate-600">📍 {o.address}</div>
                    {o.note && <div className="mt-1 rounded bg-slate-50 p-1.5 text-[11px] text-slate-600">{o.note}</div>}
                    {canManage && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {o.status === "new" && <button onClick={() => void patchStoreOrder(o.id, "accepted")} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">قبول</button>}
                        {accepted && <button onClick={() => void patchStoreOrder(o.id, "delivered")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200">✓ سُلّم</button>}
                        <button onClick={() => void patchStoreOrder(o.id, "declined")} className="rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">✕ رفض</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 🏢 عمودُ بطاقات الشركة (source=company): رفعتها سوبر سيل لهذا الوكيل مباشرةً — يظهر حين تأتيه بطاقة */}
        {coCards.length > 0 && (
          <div data-app-col className="flex max-h-full w-[280px] shrink-0 flex-col rounded-xl border border-line bg-surface-2 shadow-lg">
            <div className="flex items-center justify-between rounded-t-[11px] bg-[#16213e] px-3 py-2 text-white">
              <span className="text-sm font-bold">🏢 تذاكر الشركة</span>
              <span className="rounded-full bg-white/25 px-2 text-xs font-bold">{coCards.filter((t) => t.status === "new").length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {coCards.map((t) => {
                const done = t.status === "done", rej = t.status === "rejected";
                const due = t.dueAt ? new Date(t.dueAt) : null;
                const late = due != null && !done && !rej && due.getTime() < Date.now();
                const dueLabel = due && !isNaN(due.getTime()) ? due.toLocaleString("ar", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
                return (
                  <div key={t.id} className={`rounded-lg bg-white p-2.5 shadow-sm ${done ? "opacity-60" : rej ? "opacity-50" : ""} ${late ? "ring-1 ring-rose-300" : ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="shrink-0 rounded bg-[#16213e] px-1.5 py-0.5 text-[9px] font-bold text-white">🏢 {t.type ?? "بطاقة"}</span>
                      {t.status !== "new" && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${done ? "bg-emerald-100 text-emerald-700" : rej ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{t.status === "contacted" ? "قيد التنفيذ" : done ? "أُنجز" : "رُفض"}</span>}
                    </div>
                    {t.name && t.name !== t.type && <div className="mt-1 text-sm font-bold text-slate-800">{t.name}</div>}
                    {t.phone && t.phone !== "—" && <div className="mt-0.5 text-xs font-semibold text-slate-500"><CallPhone phone={t.phone} /></div>}
                    {dueLabel && <div className={`mt-1 text-[11px] font-semibold ${late ? "text-rose-600" : "text-slate-500"}`}>⏱️ المهلة: {dueLabel}{late ? " · متجاوَزة" : ""}</div>}
                    {t.note && <div className="mt-1 rounded bg-slate-50 p-1.5 text-[11px] text-slate-600">{t.note}</div>}
                    {canManage && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {t.status !== "contacted" && !done && !rej && <button onClick={() => void patchTicket(t.id, "contacted")} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">استلمت</button>}
                        {!done && <button onClick={() => void patchTicket(t.id, "done")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200">✓ أُنجز</button>}
                        {!rej && <button onClick={() => void patchTicket(t.id, "rejected")} className="rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">✕ رفض</button>}
                        {(done || rej) && <button onClick={() => void patchTicket(t.id, "new")} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">↩ إرجاع</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {lists.map((l) => {
          // عمود «تذاكر أودو» يظهر فقط حين «أودو نشط» (مفعّل أو به بطاقات مفتوحة) — يُخفى إن خمد
          if (!odooActive && l.name === "تذاكر أودو") return null;
          // البطاقات المنجزة تنتقل لعمود «المنجزة» فتُستبعَد من عمودها الأصلي
          const listCards = cards.filter((c) => c.listId === l.id && !c.done).sort((a, b) => a.position - b.position);
          const dragThisList = drag?.kind === "list" && drag.id === l.id;
          // أ-٤ · «العمود فوق عمودٍ ⇒ القديم يزيح جانباً»: خانةُ المسحوب تنطوي (عرضٌ صفر)
          // والأعمدةُ من موضع الإفلات فصاعداً تنزلق جانباً لتفتح له مكانَه — كإزاحة البطاقات
          // عموديّاً بالضبط، بدل شريطِ الإفلات الجامد السابق. (RTL: «بَعدُ» يعني يساراً.)
          const others = [...lists].sort((a, b) => a.position - b.position).filter((x) => !(drag?.kind === "list" && x.id === drag.id));
          const listShiftX = drag?.kind === "list" && !dragThisList && others.findIndex((x) => x.id === l.id) >= drag.index
            ? -(drag.w + 12) // عرضُ المسحوب + فجوة gap-3
            : 0;
          return (
            <Fragment key={l.id}>
            <div
              data-app-col
              data-list-id={l.id}
              style={dragThisList
                ? { width: 0, minWidth: 0, marginInlineEnd: -12, opacity: 0, overflow: "hidden", pointerEvents: "none", transition: "all .18s cubic-bezier(.2,.8,.2,1)" }
                : drag?.kind === "list"
                  ? { transform: `translateX(${listShiftX}px)`, transition: "transform .18s cubic-bezier(.2,.8,.2,1)" }
                  : undefined}
              className={`flex max-h-full w-[280px] shrink-0 flex-col rounded-xl shadow-lg ${isTech ? "bg-slate-100" : "border border-line bg-surface-2"}`}
            >
              {/* رأس العمود: بالمتصفح للمدير — خطّ أبيض على خلفية بلون فئة العمود */}
              <div
                onPointerDown={(e) => pressStart(e, "list", l.id)}
                title="بالفأرة: اسحب رأس العمود مباشرةً — وباللمس: اضغط مطوّلاً ثم اسحب"
                className={`flex items-center justify-between px-3 py-2 ${isTech ? "" : "rounded-t-[11px]"}`}
                style={!isTech ? { background: catColorOf(l.name ?? "") } : undefined}>
                <span className={`font-bold ${isTech ? "text-slate-700" : "text-white"}`}>
                  {l.name} <span className={`text-xs font-normal ${isTech ? "text-slate-400" : "text-white/75"}`}>({listCards.length})</span>
                  {l.timeTracked && <span className={`ml-1 rounded px-1 py-0.5 text-[10px] font-semibold ${isTech ? "bg-sky-100 text-sky-700" : "bg-white/25 text-white"}`} title="عمود محسوب بالوقت">⏱</span>}
                </span>
                {canEditLists && (
                  <div className={`flex gap-1 ${isTech ? "text-slate-400" : "text-white/85"}`}>
                    <button onClick={() => toggleTimeTracked(l)} className={`rounded px-1 ${l.timeTracked ? (isTech ? "text-sky-600" : "bg-white/25 text-white") : (isTech ? "hover:bg-slate-200" : "hover:bg-white/20")}`} title={l.timeTracked ? "إلغاء الاحتساب بالوقت" : "تفعيل الاحتساب بالوقت"}>⏱</button>
                    <button onClick={() => renameList(l)} className={`rounded px-1 ${isTech ? "hover:bg-slate-200" : "hover:bg-white/20"}`} title="إعادة تسمية">✏️</button>
                    <button onClick={() => deleteList(l)} className={`rounded px-1 ${isTech ? "hover:bg-red-100" : "hover:bg-white/20"}`} title="حذف">🗑️</button>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-2" style={drag?.kind === "card" && drag.toList === l.id ? { paddingBottom: drag.h + CARD_GAP } : undefined}>
                {listCards.map((c, cardIdx) => {
                  const dragged = drag?.kind === "card" && drag.id === c.id;
                  // ترتيب البطاقة بين الظاهرات (بعد استبعاد المسحوبة) — عليه تُحسب الإزاحة
                  const visIdx = drag?.kind === "card" && drag.fromList === l.id && cardIdx > listCards.findIndex((x) => x.id === drag.id) ? cardIdx - 1 : cardIdx;
                  const shift = dragged ? 0 : cardShift(l.id, visIdx);
                  // ⏳ مهلة سوبر سيل: حالةُ هذه البطاقة الآن (تُخرجها من الحساب: إنجاز/إلغاء/تأجيل)
                  const sla = slaStateOf(c as SlaCard, slaNow, slaAlarmMin, slaSendMin);
                  const slaHot = slaOn && (sla.level === "danger" || sla.level === "over");
                  const isOdoo = !!c.viaOdoo; // بطاقة واردة من أودو
                  const odooInbox = isOdoo && l.name === "تذاكر أودو"; // غير مُصنّفة بعد (صندوق الوارد)
                  const odooColor = l.name && l.name !== "تذاكر أودو" ? catColorOf(l.name) : "#7c3aed"; // لون الفئة إن أُسندت، وإلا بنفسجيّ افتراضيّ
                  // 🧪 علامةُ «مؤجّلة» الجانبيّة (الهاتف وحده): كأودو تماماً — كهرمانيّةٌ هادئة، وحين
                  //    يحلّ يومُها المقرّر تصير شريطاً أحمرَ يومض والكلمةُ بيضاء. تُوضَع يساراً كأودو،
                  //    وإن كانت البطاقةُ أودو أصلاً (يسارُها مشغول) فيميناً.
                  const isPostponed = !c.done && !!c.postponedTo;
                  const postponeDue = isPostponed && postponeDueNow(c.postponedTo);
                  const showPostpone = trialOn && isPostponed;
                  const postponeLeft = showPostpone && !isOdoo;
                  const postponeRight = showPostpone && isOdoo;
                  return (
                  <div
                    key={c.id}
                    data-card-id={c.id}
                    onPointerDown={(e) => pressStart(e, "card", c.id)}
                    onClick={() => { if (drag || Date.now() - draggedAt.current < 250) return; setSel(c); }}
                    title="بالفأرة: اسحب مباشرةً — وباللمس: اضغط مطوّلاً ثم اسحب (داخل العمود أو إلى عمود آخر)"
                    style={{
                      ...(dragged ? { ["--fm-h" as string]: `${drag!.h}px` } : null),
                      ...(shift ? { transform: `translateY(${shift}px)` } : null),
                      transition: drag ? "transform .18s cubic-bezier(.2,.8,.2,1)" : undefined,
                    }}
                    className={`relative overflow-hidden cursor-pointer rounded-lg bg-white p-2.5 shadow-sm transition hover:shadow-md ${isOdoo || postponeLeft ? "pl-7" : ""} ${postponeRight ? "pr-7" : ""} ${slaHot ? "sla-card" : ""} ${dragged ? "fm-collapsing" : ""}`}
                  >
                    {/* وسم «أودو» عاموديّ على الحافّة اليسرى: كلمةٌ مُدوَّرة ككتلة (transform) فتبقى حروفها موصولة،
                        لونها لون الفئة إن أُسندت وإلا بنفسجيّ — يبقى دائماً على بطاقة أودو */}
                    {isOdoo && (
                      <div className="absolute inset-y-0 left-0 flex w-5 items-center justify-center" style={{ background: slaHot ? "#dc26261f" : `${odooColor}1f` }} title={slaHot ? (portalOn ? "تجاوزت مهلة سوبر سيل — أنجز أو ألغِ أو أجّل" : "تجاوزت المهلة — أنجز أو ألغِ أو أجّل") : "بطاقة واردة من أودو"}>
                        <span className="text-[11px] font-extrabold leading-none" style={{ color: slaHot ? "#dc2626" : odooColor, transform: "rotate(-90deg)" }}>أودو</span>
                      </div>
                    )}
                    {/* 🧪 وسمُ «مؤجّلة» الجانبيّ (الهاتف): كأودو — كهرمانيٌّ هادئ، وحين يحلّ يومُها شريطٌ أحمر يومض بكلمةٍ بيضاء */}
                    {showPostpone && (
                      <div
                        className={`absolute inset-y-0 ${postponeRight ? "right-0" : "left-0"} flex w-5 items-center justify-center ${postponeDue ? "fm-postpone-due" : ""}`}
                        style={postponeDue ? undefined : { background: "#f59e0b1f" }}
                        title={postponeDue ? "حان يومُها المقرّر للتنفيذ" : `مؤجّلة إلى ${fmtDateTime(c.postponedTo!)}`}
                      >
                        <span className="text-[11px] font-extrabold leading-none" style={{ color: postponeDue ? "#fff" : "#b45309", transform: "rotate(-90deg)" }}>مؤجّلة</span>
                      </div>
                    )}
                    <div className={`text-sm font-medium text-slate-800 ${c.done ? "line-through opacity-60" : ""}`}>{c.title}</div>
                    {/* اسمُ المشترك على الوجه (طلبُ محمد 2026-08-13): كان الوجهُ يُظهر اليوزرَ
                        والهاتفَ والملاحظةَ — والاسمُ هو ما يعرفه الفنيُّ والمشتركُ عند الباب. */}
                    {c.subscriberName && <div className="mt-0.5 text-xs font-semibold text-slate-600">👤 {c.subscriberName}</div>}
                    {/* على الوجه: هاتف النافذة المنبثقة إن وُجد وإلا الرقم المخزون + الملاحظة — واسم المشترك يظهر بفتح البطاقة فقط */}
                    {(faceCallPhone(c.description) ?? c.odooPhone) && <div className="mt-0.5 text-xs font-semibold text-slate-500"><CallPhone phone={(faceCallPhone(c.description) ?? c.odooPhone)!} /></div>}
                    {faceNoteOf(c.description) && <div className="mt-0.5 text-xs text-slate-500">📝 {faceNoteOf(c.description)}</div>}
                    {c.techNote && <div className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">🗒️ {c.techNote}</div>}
                    {/* بطاقة التوصيل: المبلغان على الوجه قبل فتح البطاقة — الاشتراك (من باقة
                        المشترك تلقائياً) والتوصيل (كتبه المكتب عند الإنشاء). والتوصيل يظهر ولو
                        كان صفراً: «مجاناً» خبرٌ يحتاجه الفني لا فراغ يُترك له. */}
                    {!c.done && isDeliveryKind(c.kind) && (c.subAmount ?? 0) > 0 && (
                      <div className="mt-1 rounded bg-indigo-50 px-1.5 py-1 text-xs font-bold text-indigo-700">💵 مبلغ الاشتراك: {Number(c.subAmount).toLocaleString("en-US")} د.ع</div>
                    )}
                    {!c.done && isDeliveryKind(c.kind) && c.amount != null && (
                      <div className="mt-1 rounded bg-emerald-50 px-1.5 py-1 text-xs font-bold text-emerald-700">
                        🚚 مبلغ التوصيل: {Number(c.amount) > 0 ? `${Number(c.amount).toLocaleString("en-US")} د.ع` : "مجاناً"}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {/* اللون والأيقونة من **العمود** الذي تسكنه البطاقة لا من فئتها: بطاقة صيانة
                          نُقلت إلى عمود تنصيب تأخذ لون التنصيب وخصائصه — ويبقى اسمها «صيانة»
                          كما هو (طلب محمد 2026-08-05). فالعمود هو مكان العمل، والفئة هوية العمل. */}
                      {/* شارة الفئة: تُخفى لبطاقة أودو غير المُصنّفة (لا فئة — يميّزها الوسم العاموديّ) */}
                      {!odooInbox && <span className={`rounded px-1.5 py-0.5 font-semibold text-white ${kindColor(l.name ?? c.kind)}`} style={!isTech ? { background: catColorOf(l.name ?? "") } : undefined}>{isDeliveryKind(l.name ?? c.kind) ? "🚚" : "🔧"} {c.kind}</span>}
                      {c.assignee && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">👤 {c.assignee}</span>}
                      {c.dueDate && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">📅 {fmtDue(c.dueDate)}</span>}
                      {c.done && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ منجزة {c.amount != null ? `— ${Number(c.amount).toLocaleString("en-US")}` : ""}</span>}
                      {!c.done && c.postponedTo && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">📅 مؤجّلة {fmtDateTime(c.postponedTo)}</span>}
                      {!c.done && !c.postponedTo && c.startedAt && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">⏱ جارية</span>}
                      {/* شارة الإعادة من الأرشيف — يعرفها الفني فيعود إليها */}
                      {!c.done && wasRestored(c.history) && <span className="rounded bg-purple-50 px-1.5 py-0.5 font-semibold text-purple-700">↩️ معادة من الأرشيف</span>}
                      {/* ⏳ عدّاد مهلة سوبر سيل: المتبقّي حتى الغرامة (أو «انتهت المهلة») */}
                      {slaHot && (
                        <span className="rounded bg-red-600 px-1.5 py-0.5 font-extrabold text-white" title={`عمر التذكرة ${fmtMin(sla.ageMin)} — يُحتسب داخل نافذة ١٠:٠٠ص←١٢:٠٠ل فقط`}>
                          {sla.level === "over" ? "⏳ تجاوزت المهلة" : `⏳ متبقٍّ ${fmtMin(sla.toSendMin)}`}
                        </span>
                      )}
                      {/* رسالة المشترك: مؤرشفة بانتظار فتح حاسبة المكتب، أو أُرسلت، أو تعذّرت */}
                      {isOdoo && c.slaWaQueuedAt && !c.slaWaSentAt && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">📨 رسالة المشترك في الطابور</span>}
                      {isOdoo && c.slaWaSentAt && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">📨 أُبلِغ المشترك</span>}
                      {isOdoo && !c.slaWaQueuedAt && !c.slaWaSentAt && c.slaWaError && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600" title={c.slaWaError}>📵 {c.slaWaError}</span>}
                      {isOdoo && c.slaNoteAt && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">📝 أُبلِغت أودو بالتأجيل</span>}
                    </div>
                    <div className="mt-1.5">
                      {/* بطاقة «دعم مؤقت» (listId=-1): منطقة الخريطة من مكتب الدعم لا مكتب الفني */}
                      <MapButton text={`${c.title}\n${c.description ?? ""}`} towerId={c.listId === -1 ? (supportOfficeId ?? officeId) : officeId} size="sm" />
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* إضافة بطاقة — للمكتب أو للفني (تُسنَد له تلقائياً).
                  الفنيّ الممنوع من الإضافة (خيار المدير) لا يرى الزرّ، والخادم يردّ نداءه أيضاً. */}
              {canOperate && canAddCards && (
              <div className="p-2">
                {addingTo === l.id ? (
                  <div className="space-y-1.5 rounded-lg bg-white p-2 shadow-inner">
                    <textarea autoFocus value={cardText} onChange={(e) => setCardText(e.target.value)} rows={2} placeholder="عنوان البطاقة..." className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    <div className={isTech ? "" : "grid grid-cols-2 gap-1.5"}>
                      <select value={cardKind} onChange={(e) => { if (e.target.value === "__new__") createType(); else setCardKind(e.target.value); }} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                        {cardTypes.map((t) => <option key={t.id} value={t.name}>{t.deliveryOnly ? "🚚" : "🔧"} {t.name}</option>)}
                        {canManage && <option value="__new__">➕ نوع جديد…</option>}
                      </select>
                      {/* الفني تُسنَد له البطاقة تلقائياً — لا يختار فنياً */}
                      {!isTech && (
                        <select value={cardTech} onChange={(e) => setCardTech(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">— بدون فني —</option>
                          {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSupport ? " (دعم)" : ""}</option>)}
                        </select>
                      )}
                    </div>
                    <input type="date" value={cardDue} onChange={(e) => setCardDue(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                    <div className="flex gap-1">
                      <button onClick={() => addCard(l.id)} className="flex-1 rounded-lg bg-mynet-blue px-3 py-1 text-sm font-semibold text-white">إضافة البطاقة</button>
                      <button onClick={() => { setAddingTo(null); setCardText(""); setCardTech(""); setCardDue(""); setCardKind("maintenance"); }} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200">✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingTo(l.id); setCardText(""); }} className="w-full rounded-lg px-2 py-1.5 text-right text-sm text-slate-500 hover:bg-slate-200">+ إضافة بطاقة</button>
                )}
              </div>
              )}
            </div>
            </Fragment>
          );
        })}

        {/* عمود «المنجزة»: يجمع بطاقات الفنيين المنجزة (بانتظار الإكمال/التحصيل) من كل الأعمدة */}
        {lists.length > 0 && (() => {
          const doneCards = cards.filter((c) => c.done).sort((a, b) => String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? "")));
          return (
            <div data-app-col className={`flex max-h-full w-[280px] shrink-0 flex-col rounded-xl shadow-lg ${isTech ? "bg-emerald-50 ring-1 ring-emerald-200" : "border border-line bg-surface-2"}`}>
              <div className={`flex items-center justify-between px-3 py-2 ${isTech ? "" : "rounded-t-[11px]"}`}
                style={!isTech ? { background: "var(--cat-done)" } : undefined}>
                <span className={`font-bold ${isTech ? "text-emerald-800" : "text-white"}`}>✅ المنجزة <span className={`text-xs font-normal ${isTech ? "text-emerald-500" : "text-white/75"}`}>({doneCards.length})</span></span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {doneCards.length === 0 ? (
                  <div className="px-2 py-6 text-center text-[11px] leading-relaxed text-emerald-700/60">لا بطاقات منجزة — تنتقل هنا عند ضغط الفني «إنجاز»، ثم «اكمال» من «تحصيل الفنيين» لأرشفتها</div>
                ) : doneCards.map((c) => (
                  <div key={c.id} onClick={() => setSel(c)} className="cursor-pointer rounded-lg bg-white p-2.5 shadow-sm transition hover:shadow-md">
                    <div className="text-sm font-medium text-slate-800">{c.title}</div>
                    {/* اسمُ المشترك — كان غائباً عن هذا العمود وحدَه (طلبُ محمد 2026-08-19:
                        «في عامود المنجزة يجب ظهور اسم المشترك واليوزر هي وكل الاعمدة الاخرى»
                        — واليوزرُ هو عنوانُ البطاقة أعلاه، فالاسمُ كان الناقص) */}
                    {c.subscriberName && <div className="mt-0.5 text-xs font-semibold text-slate-600">👤 {c.subscriberName}</div>}
                    {(faceCallPhone(c.description) ?? c.odooPhone) && <div className="mt-0.5 text-xs font-semibold text-slate-500"><CallPhone phone={(faceCallPhone(c.description) ?? c.odooPhone)!} /></div>}
                    {/* ما كتبه الفني عند الإنجاز — على وجه البطاقة مباشرة (طلب محمد 2026-07-29؛ متصفح المدير فقط — لوحة الفني كما هي) */}
                    {!isTech && c.serviceDetails && <div className="mt-0.5 whitespace-pre-wrap rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-slate-600">🔧 {c.serviceDetails}</div>}
                    {!isTech && c.techNote && <div className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">🗒️ {c.techNote}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={`rounded px-1.5 py-0.5 font-semibold text-white ${kindColor(c.kind)}`} style={!isTech && typeColors[c.kind] ? { background: typeColors[c.kind] } : undefined}>{isDeliveryKind(c.kind) ? "🚚" : "🔧"} {c.kind}</span>
                      {c.assignee && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">👤 {c.assignee}</span>}
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700">✓ {c.amount != null ? `${Number(c.amount).toLocaleString("en-US")} د.ع` : "منجزة"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* أ-٢ · إضافة عمود — للمدير ولمستخدم المكتب (حسمه محمد 2026-08-14) */}
        {canEditLists && (
          <div data-app-col className={`w-[280px] shrink-0 rounded-xl p-2 ${isTech ? "bg-white/20" : "border border-dashed border-line bg-surface"}`}>
            <input value={newList} onChange={(e) => setNewList(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addList()} placeholder="+ إضافة عمود جديد" className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${isTech ? "bg-white/90" : "border border-line bg-surface"}`} />
            {newList.trim() && <button onClick={addList} className="mt-1 w-full rounded-lg bg-white py-1.5 text-sm font-semibold text-mynet-blue">إضافة العمود</button>}
          </div>
        )}
      </div>
        {/* خريطة التتبّع: دبوس عائم أسفل اليسار (سطح المكتب) يفتح لوحة الخريطة، ويُغلَق بالنقر خارجها */}
      </div>

      {/* شريط سفلي (لوحة الفني بالمتصفح فقط — تبقى كما هي حرفياً؛ المدير صار شريطه أعلى) */}
      {isTech && offices.length > 0 && (
        <div data-site-only className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/20 bg-black/25 px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
          {offices.map((o) => (
            <button
              key={o.id}
              onClick={() => switchOffice(o.id)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${officeId === o.id ? "bg-white text-mynet-blue shadow" : "bg-white/20 text-white hover:bg-white/35"}`}
            >
              {o.name ?? `مكتب ${o.id}`}
            </button>
          ))}
          {/* 🎯 مرتبةُ الفنيّ — **كانت في فرعٍ لا يُصيَّر أبداً**: مكتوبةً بشرط `isTech`
              داخل شريطٍ شرطُه `!isTech`، فلم يرها فنيٌّ قطّ. كُشفت وهي تُنقل في البند ١٠
              (تحذيرُ «`myRank` غيرُ مستعمل» هو ما دلّ عليها)، ومكانُها الصحيحُ شريطُ الفنيّ. */}
          {myRank && (
            <button onClick={() => setAchModal(true)} className="rounded-lg bg-white/15 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-white/25" title="اضغط لترتيب كل الفنيين">
              🏅 مرتبتك {myRank.rank}/{myRank.of} · {myRank.points} نقطة
              {myRank.avgMin != null ? ` · معدّل ${myRank.avgMin} د` : ""}
            </button>
          )}
          {(canManage || (!isTech && canOperate)) && (
            <button onClick={() => setTechModal(true)} className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-emerald-600">
              👷 الفنيون ({technicians.length})
            </button>
          )}
          {canManage && (
            <button onClick={() => setLeaveModal(true)} className="relative rounded-lg bg-amber-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-amber-600">
              📅 الإجازات
              {leavePending > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-black/25">{leavePending}</span>}
            </button>
          )}
          {canManage && (
            <button onClick={() => setDedModal(true)} className="relative rounded-lg bg-rose-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-rose-600">
              💠 الخصومات
              {dedPending > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-700 px-1 text-[11px] font-bold text-white ring-2 ring-black/25">{dedPending}</span>}
            </button>
          )}
          {canManage && (
            <button onClick={() => setAchModal(true)} title="ترتيب كل فنيّي مكاتبك بالإنجاز والسرعة" className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-amber-700">
              🏅 إنجازات الفنيين
            </button>
          )}
          {/* 🪦 حُذف من هنا زرُّ «📍 مواقع الأعمدة»: كان **كوداً ميّتاً** — شرطُه `canManage`
              داخل شريطٍ شرطُه `isTech`، ولا يجتمعان (الخادمُ يعطي الفنيَّ `canManage:false`).
              ومكانُه الآن قائمةُ «اللوحة والسجلّات» في شريط المدير حيث يراه فعلاً. */}
          {canManage && (
            <button onClick={() => setTypesModal(true)} className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-sky-700">
              ⏱ الأنواع والأوقات
            </button>
          )}
          {canOperate && !isTech && (
            <button onClick={() => setTrashModal(true)} title="البطاقات المحذوفة — تُسترجَع إلى عمودها" className="rounded-lg bg-slate-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-slate-600">
              🗑️ المحذوفة
            </button>
          )}
          {!isTech && (
            <button onClick={() => setArchiveModal(true)} className="rounded-lg bg-slate-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-slate-700">
              🗂️ الأرشيف
            </button>
          )}
          {officeId != null && (
            <button onClick={() => setSupportModal(true)} className="rounded-lg bg-purple-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-purple-600">
              🤝 دعم مؤقت
            </button>
          )}
        </div>
      )}

      {/* قائمة التطبيق الأنيقة (تظهر داخل التطبيق فقط عبر CSS) — تجمع المكاتب والأدوات */}
      {offices.length > 0 && (
        <div className="contents">
        {!isTech && (
          <div className="contents">
            <div className="trial-dockbar">
              {officeId != null && (
                <span className="td-slot">
                  {(officePanels[officeId]?.length ?? 0) > 1
                    ? officePanels[officeId].map((p, i) => (
                        <OdooConfigButton key={p.id} officeId={officeId} panelId={p.id}
                          officeName={`${offices.find((o) => o.id === officeId)?.name ?? "المكتب"} · ${p.label || `لوحة ${i + 1}`}`}
                          onChange={() => load(officeId)} />
                      ))
                    : <OdooConfigButton officeId={officeId} officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"} onChange={() => load(officeId)} />}
                </span>
              )}
              <button type="button" className="td-slot td-btn" onClick={() => setTrialOpts(true)}>⚙️ الخيارات</button>
              <button type="button" className="td-slot td-btn" onClick={() => window.dispatchEvent(new Event("trial:openTrack"))}>📍 تتبع</button>
              {canManage && <span className="td-slot td-bell"><NotificationsBell /></span>}
            </div>
            {trialOpts && (
              <div className="trial-opts-wrap" onClick={() => setTrialOpts(false)}>
                <div className="trial-opts" onClick={(e) => e.stopPropagation()}>
                  <div className="trial-opts-hd">
                    <b>⚙️ الخيارات</b>
                    <button type="button" onClick={() => setTrialOpts(false)} aria-label="إغلاق">✕</button>
                  </div>
                  {offices.length > 0 && (
                    <select
                      className="trial-opts-office"
                      value={officeId ?? ""}
                      onChange={(e) => switchOffice(Number(e.target.value))}
                      aria-label="اختيار المكتب"
                    >
                      {offices.map((o) => <option key={o.id} value={o.id}>🏢 {o.name ?? `مكتب ${o.id}`}</option>)}
                    </select>
                  )}
                  <div className="trial-tiles big">
                    {(canManage || canOperate) && (
                      <button className="tile" onClick={() => { setTrialOpts(false); setTechModal(true); }}>👷<span>الفنيون ({technicians.length})</span></button>
                    )}
                    {canManage && (
                      <button className="tile" onClick={() => { setTrialOpts(false); setLeaveModal(true); }}>📅<span>الإجازات</span>{leavePending > 0 && <b className="tbadge">{leavePending}</b>}</button>
                    )}
                    {canManage && (
                      <button className="tile" onClick={() => { setTrialOpts(false); setDedModal(true); }}>💠<span>الخصومات</span>{dedPending > 0 && <b className="tbadge">{dedPending}</b>}</button>
                    )}
                    {canManage && <button className="tile" onClick={() => { setTrialOpts(false); setAchModal(true); }}>🏅<span>إنجازات الفنيين</span></button>}
                    {officeId != null && <button className="tile" onClick={() => { setTrialOpts(false); setSupportModal(true); }}>🤝<span>دعم مؤقت</span></button>}
                    {canManage && !isTech && <button className="tile" onClick={() => { setTrialOpts(false); router.push("/attendance"); }}>🕒<span>حضور الفنيين</span></button>}
                    {canManage && <button className="tile" onClick={() => { setTrialOpts(false); setTypesModal(true); }}>⏱<span>الأنواع والأوقات</span></button>}
                    <button className="tile" onClick={() => { setTrialOpts(false); setArchiveModal(true); }}>🗂️<span>الأرشيف</span></button>
                    {canOperate && !isTech && <button className="tile" onClick={() => { setTrialOpts(false); setTrashModal(true); }}>🗑️<span>المحذوفة</span></button>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div data-app-only data-trial-hide>
          <FieldAppMenu
            offices={offices}
            officeId={officeId}
            onSelectOffice={switchOffice}
            canManage={canManage}
            canTechs={canManage || (!isTech && canOperate)}
            techCount={technicians.length}
            leavePending={leavePending}
            dedPending={dedPending}
            onTechs={() => setTechModal(true)}
            onTypes={() => setTypesModal(true)}
            onLeaves={() => setLeaveModal(true)}
            onDeductions={() => setDedModal(true)}
            onSupport={() => setSupportModal(true)}
          />
        </div>
        </div>
      )}

      {/* تفاصيل البطاقة */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={() => setSel(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <input value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} onBlur={() => saveCard({ title: sel.title })} className="flex-1 rounded-lg border border-transparent px-2 py-1 text-lg font-bold text-slate-800 hover:border-slate-200 focus:border-mynet-blue" />
              {/* زر الخريطة — يستخرج اليوزر من عنوان/وصف البطاقة (يدوية أو تلقائية) ويرشد الفني للموقع */}
              <MapButton text={`${sel.title}\n${sel.description ?? ""}`} towerId={sel.listId === -1 ? (supportOfficeId ?? officeId) : officeId} />
              <button onClick={() => setSel(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            {/* 📞 شريطُ الاتصال — «عند رفع اي بطاقة من اي مكان وحتى من الاودو» (طلبُ محمد
                2026-08-19): الرقمُ زرُّ اتصالٍ يفتح قائمةَ برامج الهاتف، لا نصٌّ يُنسخ.
                وبطاقةُ أودو هاتفُها في حقلها المستقلّ (odooPhone) فيُرتَدّ إليه. */}
            {(faceCallPhone(sel.description) ?? sel.odooPhone) && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50/70 px-3 py-2 text-sm font-semibold text-slate-700">
                <CallPhone phone={(faceCallPhone(sel.description) ?? sel.odooPhone)!} />
              </div>
            )}

            {sel.userPassword && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm">
                <span className="shrink-0 font-semibold text-slate-600">🔑 باسورد اليوزر:</span>
                <span dir="ltr" className="select-all font-extrabold tracking-wide text-slate-900">{sel.userPassword}</span>
              </div>
            )}

            {!canOperate && (
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-700">👁️ مشاهدة فقط — بطاقة مكتب آخر (لا يمكنك التعديل)</div>
            )}

            <label className="mb-1 block text-xs font-semibold text-slate-500">الحالة (العمود)</label>
            <select value={sel.listId} onChange={(e) => moveCard(sel, Number(e.target.value))} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>

            {/* التصنيف: الفني يراه فقط (تغييره يبدّل خصائص البطاقة وعمودها ⇒ للمستخدم/المدير) */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">التصنيف</label>
            {isTech ? (
              <div className="mb-3">
                <span className={`inline-block rounded-lg px-3 py-1.5 text-xs font-bold text-white ${kindColor(sel.kind)}`}>
                  {isDeliveryKind(sel.kind) ? "🚚" : "🔧"} {sel.kind}
                </span>
              </div>
            ) : (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {cardTypes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => saveCard({ kind: t.name })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white transition ${kindColor(t.name)} ${sel.kind === t.name ? "ring-2 ring-slate-800 ring-offset-1" : "opacity-55 hover:opacity-100"}`}
                  >
                    {t.deliveryOnly ? "🚚" : "🔧"} {t.name}
                  </button>
                ))}
                {!cardTypes.some((t) => t.name === sel.kind) && (
                  <button className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ring-2 ring-slate-800 ring-offset-1 ${kindColor(sel.kind)}`}>{sel.kind}</button>
                )}
                {canManage && (
                  <button onClick={createType} className="rounded-lg border border-dashed border-slate-400 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">➕ نوع</button>
                )}
              </div>
            )}

            <label className="mb-1 block text-xs font-semibold text-slate-500">الفني المسؤول</label>
            {isTech ? (
              // الفني: يرى المسؤول، ويستلم البطاقة غير المُسندة أو يحوّلها على نفسه من فنيٍّ آخر بمكتبه
              <div className="mb-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  👤 {sel.assignee ?? "بدون فني"}{sel.technicianId != null && sel.technicianId === myTechId ? " (أنت)" : ""}
                </div>
                {!sel.done && myTechId != null && sel.technicianId !== myTechId && (
                  <button onClick={claimCard} className="mt-2 w-full rounded-lg bg-mynet-blue py-2.5 text-sm font-bold text-white hover:bg-mynet-blue-dark">
                    {sel.technicianId == null ? "🙋 أستلمها أنا" : "↪️ حوّلها لي"}
                  </button>
                )}
              </div>
            ) : technicians.length > 0 ? (
              <select
                value={sel.technicianId ?? ""}
                onChange={(e) => {
                  const t = technicians.find((x) => String(x.id) === e.target.value);
                  saveCard({ technicianId: t?.id ?? null, assignee: t?.name ?? null });
                }}
                className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— بدون فني —</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSupport ? " (دعم)" : ""}</option>)}
              </select>
            ) : (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                لا يوجد فنيون لهذا المكتب بعد{canManage ? " — أضِفهم من زر «الفنيون» بالأعلى" : ""}.
              </div>
            )}

            <label className="mb-1 block text-xs font-semibold text-slate-500">تاريخ الاستحقاق</label>
            <input type="date" value={sel.dueDate ? sel.dueDate.slice(0, 10) : ""} onChange={(e) => saveCard({ dueDate: e.target.value || null })} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />

            {/* المحتوى: يُعرض دائماً (يشاهده الفني قبل البدء)؛ التعديل بعد «بدء» فقط، والبدء لا يزال شرطاً للإنجاز */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">الوصف / التفاصيل</label>
            {(sel.startedAt || sel.done) ? (
              <textarea value={sel.description ?? ""} onChange={(e) => setSel({ ...sel, description: e.target.value })} onBlur={() => saveCard({ description: sel.description })} rows={4} placeholder="تفاصيل الطلب / الصيانة / التنصيب..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            ) : (
              <div className="mb-3 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                {sel.description?.trim() ? descNoDupUser(sel.description, sel.title) : <span className="text-slate-400">لا توجد تفاصيل</span>}
                {sel.postponedTo && <div className="mt-2 font-bold text-amber-600">📅 مؤجّلة إلى {fmtDateTime(sel.postponedTo)}</div>}
                {canOperate && <div className="mt-2 text-[11px] text-slate-400">اضغط «بدء العمل» لبدء احتساب الوقت والتمكّن من التعديل والإنجاز.</div>}
              </div>
            )}

            {/* تنبيه الوقت المسموح — عمود محسوب بالوقت ونوع غير توصيل له وقت */}
            {(() => {
              const lst = lists.find((l) => l.id === sel.listId);
              const ty = cardTypes.find((t) => t.name === sel.kind);
              if (!lst?.timeTracked || ty?.deliveryOnly || !ty?.execMinutes) return null;
              return (
                <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
                  ⏱ عمود محسوب بالوقت — الوقت المسموح لهذا النوع: <b>{ty.execMinutes} دقيقة</b>
                  {(ty.overrunDeduction ?? 0) > 0 && <> · خصم التجاوز <b>{ty.overrunDeduction}</b>/دقيقة</>}
                </div>
              );
            })()}

            {/* ملاحظة الفني — حقل يكتب فيه الفني (تظهر على وجه البطاقة ويراها الجميع) */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">🗒️ ملاحظة الفني</label>
            <textarea
              value={sel.techNote ?? ""}
              onChange={(e) => setSel({ ...sel, techNote: e.target.value })}
              onBlur={() => { void fetch("/api/field/card-note", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel.id, techNote: sel.techNote }) }).then(() => load()); }}
              rows={2}
              placeholder="ملاحظة يكتبها الفني على البطاقة…"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />

            {sel.done ? (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="mb-1 font-bold text-emerald-700">✓ منجزة (بانتظار التحصيل)</div>
                {sel.amount != null && <div className="text-slate-600">المبيع: <b>{Number(sel.amount).toLocaleString("en-US")}</b> د.ع</div>}
                {(sel.subAmount ?? 0) > 0 && <div className="text-slate-600">اشتراك (يُسجَّل عند التفعيل): <b className="text-indigo-700">{Number(sel.subAmount).toLocaleString("en-US")}</b> د.ع</div>}
                {sel.serviceDetails && <div className="text-slate-600">التفاصيل: {sel.serviceDetails}</div>}
                {sel.durationSec != null && <div className="text-slate-600">⏱ مدة الإنجاز: <b>{fmtDuration(sel.durationSec)}</b></div>}
                {sel.materialsInfo && (() => { try { const m = JSON.parse(sel.materialsInfo) as { name: string; qty: number }[]; return <div className="text-slate-600">المواد: {m.map((x) => `${x.name}×${x.qty}`).join("، ")}</div>; } catch { return null; } })()}
                {/* ↩️ إلغاء الإنجاز (طلب محمد 2026-08-05): الخادم كان يقبله منذ زمن ولا زرّ له،
                    فكان الطريق الوحيد: «اكمال» ثم استرجاع من الأرشيف — التفافٌ لا معنى له. */}
                {canOperate && !isTech && (
                  <button onClick={() => void undoDone()} className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-xs font-bold text-amber-700 ring-1 ring-amber-300 hover:bg-amber-50">
                    ↩️ إلغاء الإنجاز — تعود للانتظار في عمودها
                  </button>
                )}
              </div>
            ) : !(canOperate && (!isTech || sel.technicianId === myTechId)) ? (
              // الفني يرى بطاقة زميله بلا أزرار عمل (يحوّلها لنفسه أولاً)
              isTech && sel.technicianId != null && sel.technicianId !== myTechId
                ? <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-400">هذه البطاقة على {sel.assignee ?? "فني آخر"} — حوّلها لك للعمل عليها.</div>
                : null
            ) : !sel.startedAt && !isDeliveryKind(sel.kind) ? (
              // غير التوصيل: «بدء» شرط للإنجاز (يحسب الوقت) — والمدير يستطيع الإلغاء قبل البدء
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  onClick={startCard}
                  className={`rounded-lg bg-mynet-blue px-4 py-3 text-base font-bold text-white hover:bg-mynet-blue-dark ${isTech ? "col-span-2" : ""}`}
                >
                  ▶ بدء العمل
                </button>
                {!isTech && (
                  <button onClick={() => void cancelCard()} title="إلغاء البطاقة بملاحظة إلزامية — تنتقل لعمود «الغاء»" className="rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700">
                    🚫 الغاء
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* التوصيل يظهر أزراره مباشرة بلا «بدء» (قاعدة بطاقة التوصيل) */}
                {sel.startedAt && <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700">⏱ بدأ العمل: {fmtDateTime(sel.startedAt)}</div>}
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setCompleting(sel); setSel(null); }}
                    disabled={sel.technicianId == null}
                    title={sel.technicianId == null ? "وجّه البطاقة لفني أولاً" : ""}
                    className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    ✓ إنجاز
                  </button>
                  <button
                    onClick={() => { setPostponing(sel); setSel(null); }}
                    className="rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
                  >
                    📅 تأجيل
                  </button>
                  <button
                    onClick={() => void noAnswerCard()}
                    title="اتصلتُ بالمشترك ولم يجب — البطاقة تبقى وتُرسل له رسالة"
                    className="rounded-lg bg-slate-500 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-600"
                  >
                    📵 ميجاوب
                  </button>
                  <button
                    onClick={() => void cancelCard()}
                    title="إلغاء البطاقة بملاحظة إلزامية — تنتقل لعمود «الغاء»"
                    className="rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700"
                  >
                    🚫 الغاء
                  </button>
                </div>
              </>
            )}

            {/* سجل تغييرات البطاقة — كل حدث بوقته وفاعله (تأجيل/تحويل/نقل/إنجاز…) + تاريخ الإنشاء */}
            {/* 🧰 سجلُّ صيانات المشترك — يظهر بفتح البطاقة، ويتمدّد بالضغط (طلبُ محمد) */}
            <MaintenanceHistory cardId={sel.id} />

            {(parseHistory(sel.history).length > 0 || sel.createdAt) && (
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="mb-1.5 text-xs font-bold text-slate-600">🕓 سجل التغييرات</div>
                <ul className="max-h-44 space-y-1 overflow-y-auto">
                  {parseHistory(sel.history).slice().reverse().map((e, i) => (
                    <li key={i} className="rounded bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600">
                      <span dir="ltr" className="font-semibold text-slate-400">{fmtDateTime(e.at)}</span> — <b className="text-slate-700">{e.by}</b>: {e.text}
                    </li>
                  ))}
                  {/* تاريخ الإنشاء دوماً آخر السجل (البطاقات القديمة بلا حدث «إنشاء» مسجَّل) */}
                  {sel.createdAt && !parseHistory(sel.history).some((e) => e.text.startsWith("إنشاء البطاقة")) && (
                    <li className="rounded bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600">
                      <span dir="ltr" className="font-semibold text-slate-400">{fmtDateTime(sel.createdAt)}</span> — 🟢 إنشاء البطاقة
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {canOperate && !isTech && <button onClick={archiveCard} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">🗂️ أرشفة</button>}
              {canOperate && !isTech && <button onClick={deleteCard} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">🗑️ حذف البطاقة</button>}
            </div>
          </div>
        </div>
      )}

      {/* نافذة التأجيل */}
      {postponing && (
        <PostponeModal
          card={postponing}
          portalOn={portalOn}
          onClose={() => setPostponing(null)}
          onDone={() => { setPostponing(null); load(officeId); }}
        />
      )}

      {/* نافذة الدعم المؤقّت */}
      {supportModal && officeId != null && (
        <SupportModal officeId={officeId} onClose={() => setSupportModal(false)} onChange={() => load(officeId)} />
      )}

      {/* نافذة الأرشيف: البطاقات المحصَّلة (أسبوع ثم تُحذف نهائياً) بفلاتر تاريخ/فني/نوع */}
      {archiveModal && (
        <ArchiveModal cardTypes={cardTypes} offices={offices} onClose={() => setArchiveModal(false)} onChanged={() => load(officeId)} />
      )}

      {/* نافذة إنجاز البطاقة بحقولها الواجبة */}
      {completing && (
        <CompletionModal
          card={completing}
          deliveryOnly={isDeliveryKind(completing.kind)}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); load(officeId); }}
        />
      )}

      {/* إدارة الفنيين (إضافة/حذف) — لصاحب صلاحية field.manage */}
      {techModal && (
        <TechnicianManager
          officeId={officeId}
          officeName={isManager ? (offices.find((o) => o.id === officeId)?.name ?? "المكتب") : "المكتب"}
          onClose={() => setTechModal(false)}
          onChange={() => load(officeId)}
        />
      )}

      {leaveModal && (
        <LeaveReview
          officeId={officeId}
          officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"}
          onClose={() => setLeaveModal(false)}
          onChange={() => loadLeavePending(officeId)}
        />
      )}

      {achModal && <AchievementsModal onClose={() => setAchModal(false)} />}

      {trashModal && (
        <DeletedCardsModal
          officeId={officeId}
          officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"}
          onClose={() => setTrashModal(false)}
          onChange={() => load(officeId)}
        />
      )}

      {mapModal && (
        <MapProposalReview onClose={() => setMapModal(false)} onChange={loadMapPending} />
      )}

      {dedModal && (
        <DeductionReview
          officeId={officeId}
          officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"}
          onClose={() => setDedModal(false)}
          onChange={() => loadDedPending(officeId)}
        />
      )}

      {typesModal && (
        <CardTypeManager
          types={cardTypes}
          colors={typeColors}
          onColor={(name, color) => void setTypeColor(name, color)}
          onClose={() => setTypesModal(false)}
          onChange={() => load(officeId)}
        />
      )}

      {/* شريط الفني السفلي: بصمة + عمليات */}
      {role === "technician" && <TechOpsBar techName={myName} />}
    </div>
    </FieldTrackerProvider>
  );
}

/* ========== نافذة الدعم المؤقّت (استعارة فني من مكتب آخر: بطاقات محدّدة أو يوم كامل) ========== */
type SupportTech = { id: number; name: string; homeOffice: string; supportKind?: string | null };
type SupportCard = { id: number; title: string; kind: string; assignee: string | null };
function SupportModal({ officeId, onClose, onChange }: { officeId: number; onClose: () => void; onChange: () => void }) {
  const [borrowed, setBorrowed] = useState<SupportTech[]>([]);
  const [candidates, setCandidates] = useState<SupportTech[]>([]);
  const [officeCards, setOfficeCards] = useState<SupportCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<SupportTech | null>(null); // الفني الجاري استعارته
  const [kind, setKind] = useState<"day" | "cards">("day");
  const [selCards, setSelCards] = useState<number[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch(`/api/field/support?officeId=${officeId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setBorrowed(d.borrowed ?? []); setCandidates(d.candidates ?? []); setOfficeCards(d.cards ?? []); }
    });
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  function startBorrow(t: SupportTech) { setPicking(t); setKind("day"); setSelCards([]); setMsg(""); }
  const toggleCard = (id: number) => setSelCards((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function confirmBorrow() {
    if (!picking) return;
    if (kind === "cards" && selCards.length === 0) { setMsg("اختر بطاقة واحدة على الأقل"); return; }
    setBusy(true); setMsg("");
    const r = await fetch("/api/field/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId: picking.id, officeId, kind, cardIds: kind === "cards" ? selCards : undefined }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر طلب الدعم"); return; }
    setPicking(null); load(); onChange();
  }
  async function ret(id: number) {
    if (!confirm("إنهاء الدعم وإعادة الفني لمكتبه؟")) return;
    setBusy(true);
    await fetch(`/api/field/support?technicianId=${id}`, { method: "DELETE" });
    setBusy(false); load(); onChange();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🤝 دعم مؤقّت</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>
        <p className="mb-3 text-xs text-slate-500">استعِر فنياً من مكتب آخر ليعمل مؤقتاً في هذا المكتب. تتحوّل بصمته لهذا المكتب، ويعود لمكتبه تلقائياً بإكمال بطاقات الدعم أو بنهاية دوامه بعد بصمة الخروج.</p>
        {msg && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</div>}

        {/* اختيار نوع الدعم للفني الجاري استعارته */}
        {picking ? (
          <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/60 p-3">
            <div className="mb-2 text-sm font-bold text-slate-800">دعم «{picking.name}» — من {picking.homeOffice}</div>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-white p-1">
              <button onClick={() => setKind("day")} className={`rounded-lg py-2 text-sm font-bold transition ${kind === "day" ? "bg-purple-600 text-white shadow" : "text-slate-500"}`}>دعم يوم كامل</button>
              <button onClick={() => setKind("cards")} className={`rounded-lg py-2 text-sm font-bold transition ${kind === "cards" ? "bg-purple-600 text-white shadow" : "text-slate-500"}`}>بطاقات محدّدة</button>
            </div>
            {kind === "cards" && (
              <div className="mb-3 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
                {officeCards.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-400">لا بطاقات غير منجزة في هذا المكتب</div>
                ) : officeCards.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={selCards.includes(c.id)} onChange={() => toggleCard(c.id)} className="h-4 w-4 accent-purple-600" />
                    <span className="flex-1 truncate text-slate-700">{c.title}</span>
                    <span className="text-[10px] text-slate-400">{c.kind}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={confirmBorrow} disabled={busy} className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-60">{busy ? "..." : kind === "cards" ? `تأكيد الدعم (${selCards.length})` : "تأكيد دعم اليوم"}</button>
              <button onClick={() => setPicking(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        ) : (
          <>
            {borrowed.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-sm font-bold text-purple-700">المُعارون حالياً</div>
                <ul className="space-y-1.5">
                  {borrowed.map((t) => (
                    <li key={t.id} className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                      <div><div className="text-sm font-semibold text-slate-700">{t.name}</div><div className="text-xs text-slate-400">من {t.homeOffice} · {t.supportKind === "cards" ? "بطاقات محدّدة" : "يوم كامل"}</div></div>
                      <button disabled={busy} onClick={() => ret(t.id)} className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100">↩ إنهاء الدعم</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mb-1.5 text-sm font-bold text-slate-700">فنيّو المكاتب الأخرى</div>
            {candidates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-sm text-slate-400">لا يوجد فنيون متاحون للاستعارة</div>
            ) : (
              <ul className="space-y-1.5">
                {candidates.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div><div className="text-sm font-semibold text-slate-700">{t.name}</div><div className="text-xs text-slate-400">من {t.homeOffice}</div></div>
                    <button disabled={busy} onClick={() => startBorrow(t)} className="rounded bg-purple-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-purple-600">طلب دعم</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ========== نافذة تأجيل البطاقة ========== */
function PostponeModal({ card, onClose, onDone, portalOn }: { card: Card; onClose: () => void; onDone: () => void; portalOn: boolean }) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // بطاقة أودو: الملاحظة إلزاميّة — التأجيل عند أودو **هو** هذه الملاحظة (إنجاز=close · إلغاء=cancel · تأجيل=ملاحظة)
  const isOdoo = !!card.viaOdoo;
  const [note, setNote] = useState("");
  async function submit() {
    setErr("");
    if (!when) { setErr("حدّد موعد المشترك (تاريخ ووقت)"); return; }
    if (isOdoo && !note.trim()) { setErr("اكتب ملاحظة التأجيل — تُرسَل إلى أودو"); return; }
    setBusy(true);
    const r = await fetch("/api/field/postpone", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, postponeTo: new Date(when).toISOString(), note: note.trim() }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر التأجيل"); return; }
    onDone();
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-slate-800">📅 تأجيل: {card.title}</h3>
        <p className="mb-3 text-sm text-slate-500">المشترك غير متواجد — حدّد الموعد الذي يريده.</p>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {isOdoo && (
          <div className="mb-3">
            <label className="mb-1 block text-xs font-bold text-violet-700">ملاحظة التأجيل — تُرسَل إلى أودو (إلزاميّة)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="مثال: تم التأجيل بطلب من المشترك — موعد جديد يوم…"
              className="w-full resize-none rounded-lg border border-violet-300 px-3 py-2 text-sm outline-none focus:border-violet-500" />
            <p className="mt-1 text-[11px] text-slate-500">{portalOn ? "بلا ملاحظةٍ تبقى التذكرة بلا حركة عند سوبر سيل وتقع الغرامة." : "بلا ملاحظةٍ تبقى التذكرة بلا حركة وتقع الغرامة."}</p>
          </div>
        )}
        {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{busy ? "جارٍ…" : "تأجيل"}</button>
          <button onClick={onClose} className="rounded-lg bg-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

/* ========== نافذة إنجاز البطاقة ========== */
type CustodyMat = { itemId: number; name: string; priceSale: number; available: number };
function CompletionModal({ card, deliveryOnly, onClose, onDone }: { card: Card; deliveryOnly: boolean; onClose: () => void; onDone: () => void }) {
  const isTransfer = card.kind === "تحويل";
  const isDelivery = deliveryOnly && !isTransfer;
  const fullFields = !isDelivery && !isTransfer; // صيانة/تنصيب/اعادة: تفاصيل كاملة
  // «التدفق الكامل» = كل الأنواع عدا التوصيل (يشمل التحويل بشروطه القديمة + الجديدة):
  // مواد متسلسلة + «المبيع» + «اشتراك»
  const isOdoo = !!card.viaOdoo; // بطاقة أودو = بطاقة عاديّة (قد يُباع للمشترك) — تُضاف فقط BG عند الإنجاز
  const fullFlow = !isDelivery; // أودو ضمن التدفّق الكامل (مبيع/مواد/اشتراك متاحة كأيّ بطاقة)
  const odooBgRequired = isOdoo && !!card.usernameRequired; // بطاقة أودو تشترط اليوزر
  const [odooBg, setOdooBg] = useState("");
  const [details, setDetails] = useState("");
  const [newUser, setNewUser] = useState("");
  const [amount, setAmount] = useState(""); // «التوصيل»: يكتبه الفني عند الباب (صفر أو أي رقم)
  const [saleStr, setSaleStr] = useState("0"); // «المبيع»: يتزامن مع مجموع المواد حتى أول تعديل يدوي
  const [saleDirty, setSaleDirty] = useState(false);
  // «اشتراك»: في التوصيل يصل محسوباً من باقة المشترك **وللفني تعديله**؛ وفي غيره يُكتب يدوياً
  const [subStr, setSubStr] = useState(isDelivery && card.subAmount != null ? String(card.subAmount) : "");
  const [rewardsOn, setRewardsOn] = useState(false); // مكتب المشترك مفعّل للمكافآت
  const [reward, setReward] = useState<{ balance: number; name: string | null } | null>(null); // رصيد مكافأة المشترك (إن وُجد)
  const [rewardPulled, setRewardPulled] = useState(false); // سُحب الكود لهذا الإنجاز
  const [noCode, setNoCode] = useState(false); // «ليس لديه كود» عند السحب
  const [rewardBusy, setRewardBusy] = useState(false); // ضُغط «سحب» والاستعلام لم يكتمل بعد
  const rewardLookup = useRef<Promise<{ balance: number; name: string | null } | null> | null>(null); // استعلام الرصيد الجاري
  const [mats, setMats] = useState<CustodyMat[]>([]);
  // سلسلة قوائم المواد: الأولى إلزامية (مادة أو «بلا مبيع»)، وكل اختيار يُظهر قائمة اختيارية جديدة
  type MatRow = { itemId: number | "nosale" | ""; qty: number };
  const [rows, setRows] = useState<MatRow[]>([{ itemId: "", qty: 1 }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!fullFlow || card.technicianId == null) return;
    fetch(`/api/field/tech-custody?technicianId=${card.technicianId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMats(d.materials ?? []));
  }, [card.technicianId, fullFlow]);

  // رصيد مكافأة مشترك البطاقة (يخصم من «المبيع» حصراً) — لكل التدفق الكامل بما فيه التحويل
  // نحتفظ بوعد الاستعلام: ضغطة «سحب» تنتظره إن لم يكتمل بعد فيأتي الجواب صحيحاً فوراً (لا «ليس لديه كود» خاطئة)
  useEffect(() => {
    if (isDelivery) return;
    rewardLookup.current = fetch(`/api/rewards/lookup?cardId=${card.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return null;
        setRewardsOn(!!d.rewardsEnabled);
        if (d.found && d.rewardsEnabled && (d.balance ?? 0) > 0) {
          const rw = { balance: d.balance as number, name: (d.name ?? null) as string | null };
          setReward(rw);
          return rw;
        }
        return null;
      })
      .catch(() => null);
  }, [card.id, isDelivery]);

  // سحب الكود: فوري إن اكتمل الاستعلام، وإلا ينتظره (زر «…») ثم يجيب بدقة
  async function pullReward() {
    if (rewardBusy || rewardPulled) return;
    if (reward) { setNoCode(false); setRewardPulled(true); return; }
    setRewardBusy(true);
    const rw = await (rewardLookup.current ?? Promise.resolve(null));
    setRewardBusy(false);
    if (rw) { setNoCode(false); setRewardPulled(true); } else setNoCode(true);
  }

  // المشتقات: المواد المختارة + «بلا مبيع» + المجاميع
  const noSale = rows[0]?.itemId === "nosale";
  const pickedRows = rows.filter((r): r is { itemId: number; qty: number } => typeof r.itemId === "number");
  const materialsTotal = pickedRows.reduce((s, r) => {
    const m = mats.find((x) => x.itemId === r.itemId); return s + (m ? m.priceSale * r.qty : 0);
  }, 0);
  const nSale = noSale ? 0 : Number(saleStr) || 0;
  const nSub = Number(subStr) || 0;
  const nAmount = Number(amount) || 0; // للتوصيل فقط

  // «المبيع» يتزامن تلقائياً مع مجموع المواد حتى أول تعديل يدوي (زر ↺ يعيد المزامنة)
  useEffect(() => {
    if (!saleDirty && !noSale) setSaleStr(String(materialsTotal));
    if (noSale) setSaleStr("0");
  }, [materialsTotal, saleDirty, noSale]);

  // تغيير قائمة: «بلا مبيع» (الأولى فقط) يطوي السلسلة؛ واختيار مادة بآخر قائمة يضيف قائمة جديدة
  function setRowItem(idx: number, value: string) {
    setRows((rs) => {
      const next = rs.map((r, i) => (i === idx ? { ...r, itemId: value === "nosale" ? "nosale" as const : (value === "" ? "" as const : Number(value)) } : r));
      if (idx === 0 && value === "nosale") return [{ itemId: "nosale" as const, qty: 1 }];
      const compact = next.filter((r, i) => r.itemId !== "" || i === next.length - 1);
      const last = compact[compact.length - 1];
      if (last && last.itemId !== "") compact.push({ itemId: "", qty: 1 });
      return compact.length ? compact : [{ itemId: "", qty: 1 }];
    });
  }
  function setRowQty(idx: number, q: number) {
    setRows((rs) => rs.map((r, i) => {
      if (i !== idx || typeof r.itemId !== "number") return r;
      const m = mats.find((x) => x.itemId === r.itemId);
      return { ...r, qty: Math.max(1, Math.min(q, m?.available ?? 99)) };
    }));
  }
  function removeRow(idx: number) {
    setRows((rs) => {
      const next = rs.filter((_, i) => i !== idx);
      if (!next.length || next[next.length - 1].itemId !== "") next.push({ itemId: "", qty: 1 });
      return next;
    });
  }

  async function submit() {
    setErr("");
    if (isDelivery) {
      if (amount.trim() === "") { setErr("اكتب مبلغ التوصيل (0 إن كان مجاناً)"); return; }
      if (nAmount < 0) { setErr("المبلغ لا يكون سالباً"); return; }
      if (nAmount > 0 && nAmount < 1000) { setErr("مبلغ التوصيل لا يقل عن 1000 دينار (أو صفر للمجاني)"); return; }
      if (nSub > 0 && nSub < 1000) { setErr("مبلغ الاشتراك لا يقل عن 1000 دينار (أو صفر)"); return; }
    } else {
      if (isTransfer && !newUser.trim()) { setErr("اليوزر الجديد مطلوب لإنجاز التحويل"); return; }
      if (fullFields) {
        if (!details.trim()) { setErr("تفاصيل الصيانة مطلوبة"); return; }
      }
      // بطاقة أودو تشترط اليوزر (BG) — بصيغة bg-x-x-x@x
      if (odooBgRequired && !/^bg-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-?@[a-z0-9]+$/i.test(odooBg.trim())) {
        setErr("أدخل اليوزر (BG) بصيغة bg-x-x-x@x"); return;
      }
      // القائمة الأولى إلزامية: مادة أو «بلا مبيع» (أودو كأيّ بطاقة — قد يُباع للمشترك)
      if (pickedRows.length === 0 && !noSale) { setErr("اختر مادة من ذمّتك أو «بلا مبيع» (إلزامي)"); return; }
      // «المبيع»: 0 جائز، وما فوقه ≥ 1000
      if (nSale > 0 && nSale < 1000) { setErr("مبلغ المبيع لا يقل عن 1000 دينار (أو صفر)"); return; }
      // «اشتراك»: إلزامي كتابته يدوياً ولو 0، وما فوق الصفر ≥ 1000
      if (subStr.trim() === "") { setErr("أدخِل مبلغ «اشتراك» — اكتب 0 إن لم يُستلم اشتراك"); return; }
      if (nSub > 0 && nSub < 1000) { setErr("مبلغ الاشتراك لا يقل عن 1000 دينار (أو صفر)"); return; }
    }
    setBusy(true);
    const materials = pickedRows.map((r) => ({ itemId: r.itemId, qty: r.qty }));
    const r = await fetch("/api/field/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cardId: card.id, serviceDetails: details, newUser, odooBg,
        amount: isDelivery ? nAmount : undefined,
        sale: isDelivery ? undefined : nSale,
        // التوصيل يرسل الاشتراك أيضاً — لأن الفني قد يعدّله عمّا حسبته الباقة
        subscription: nSub,
        materials, useReward: rewardPulled, noSale,
      }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر الإنجاز"); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
          <h3 className="text-lg font-bold text-slate-800">{isTransfer ? "🔁 إنجاز تحويل" : isDelivery ? "🚚 إنجاز توصيل" : isOdoo ? "🔗 إنجاز تذكرة أودو" : "🔧 إنجاز صيانة"}: {card.title}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>
        {/* الجسم القابل للتمرير — الأزرار في تذييل ثابت أسفله فلا تتداخل */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <div className="h-1" />

        {isTransfer && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">اليوزر الجديد <span className="text-red-500">*</span></label>
            <input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="اكتب اليوزر الجديد للمشترك" dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}

        {fullFields && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">{isOdoo ? "ملاحظة الإنجاز (تُرسَل إلى أودو)" : "تفاصيل الصيانة"} <span className="text-red-500">*</span></label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="ماذا تمّ من عمل..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}

        {/* بطاقة أودو تشترط اليوزر (BG) — يُرسَل إلى أودو (change_bg_field) عند الإنجاز */}
        {odooBgRequired && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">اليوزر (BG) <span className="text-red-500">*</span></label>
            <input value={odooBg} onChange={(e) => setOdooBg(e.target.value)} placeholder="bg-x-x-x@x" dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}

        {/* التوصيل: المبلغان بيد الفني عند الباب — الاشتراك يصل محسوباً من الباقة **وله
            تعديله**، والتوصيل يكتبه (صفر أو أي رقم). فلا رقم يُفرَض من فوق. */}
        {isDelivery && (<>
          <label className="mb-1 block text-xs font-semibold text-slate-500">
            💵 مبلغ الاشتراك <span className="text-slate-400">(محسوب من باقة المشترك — عدّله إن اختلف)</span>
          </label>
          <input type="number" value={subStr} onChange={(e) => setSubStr(e.target.value)} placeholder="0" dir="ltr"
            className="mb-3 w-full rounded-lg border border-indigo-300 bg-indigo-50/40 px-3 py-2 text-sm font-bold" />
          <label className="mb-1 block text-xs font-semibold text-slate-500">
            🚚 مبلغ التوصيل <span className="text-slate-400">(اكتب 0 إن كان مجاناً)</span>
          </label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" dir="ltr"
            className="mb-3 w-full rounded-lg border border-emerald-300 bg-emerald-50/40 px-3 py-2 text-sm font-bold" />
        </>)}

        {/* سلسلة قوائم المواد: الأولى إلزامية (مادة أو «بلا مبيع») وكل اختيار يُظهر قائمة جديدة */}
        {fullFlow && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">المواد من ذمّتك <span className="text-red-500">* الأولى إلزامية</span> — وبجانب كل مادة الكمية</label>
            <div className="mb-3 space-y-1.5">
              {rows.map((row, idx) => {
                const chosen = typeof row.itemId === "number" ? mats.find((m) => m.itemId === row.itemId) : null;
                return (
                  <div key={idx} className="flex items-center gap-1.5">
                    <select
                      value={row.itemId === "" ? "" : String(row.itemId)}
                      onChange={(e) => setRowItem(idx, e.target.value)}
                      className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm ${row.itemId !== "" ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
                    >
                      <option value="">{idx === 0 ? "— اختر مادة أو «بلا مبيع» —" : "— مادة إضافية (اختياري) —"}</option>
                      {idx === 0 && <option value="nosale">🚫 بلا مبيع (لا مادة — المبيع صفر)</option>}
                      {mats.map((m) => (
                        <option key={m.itemId} value={m.itemId}>{m.name} ({m.priceSale.toLocaleString("en-US")} — متاح {m.available})</option>
                      ))}
                    </select>
                    {chosen && (
                      <input type="number" value={row.qty} min={1} max={chosen.available}
                        onChange={(e) => setRowQty(idx, Number(e.target.value))}
                        className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm" dir="ltr" title="الكمية" />
                    )}
                    {row.itemId !== "" && !noSale && (
                      <button type="button" onClick={() => removeRow(idx)} className="shrink-0 rounded-full px-1.5 text-red-400 hover:text-red-600" title="إزالة">✕</button>
                    )}
                  </div>
                );
              })}
              {mats.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">لا مواد بذمّتك — اختر «بلا مبيع».</div>}
            </div>

            {/* «المبيع»: مجموع المواد تلقائياً — قابل للتعديل زيادةً ونقصاناً (يوزَّع نسبياً على الفاتورة) */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              المبيع <span className="text-slate-400">(مجموع المواد {materialsTotal.toLocaleString("en-US")} — عدّله وسيوزَّع على أسعار الفاتورة نسبياً)</span>
            </label>
            <div className="mb-3 flex items-center gap-1.5">
              <input type="number" value={saleStr} disabled={noSale}
                onChange={(e) => { setSaleDirty(true); setSaleStr(e.target.value); }}
                placeholder="0" dir="ltr" className="w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm disabled:bg-slate-100" />
              {saleDirty && !noSale && (
                <button type="button" onClick={() => { setSaleDirty(false); setSaleStr(String(materialsTotal)); }}
                  className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200" title="إعادة لمجموع المواد">↺</button>
              )}
            </div>

            {/* «اشتراك»: إلزامي كتابته يدوياً ولو 0 — معلوماتي بلا أثر مالي (يُسجَّل عند التفعيل) */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              اشتراك <span className="text-red-500">* إلزامي</span> <span className="text-slate-400">(اكتب 0 إن لم يُستلم — يظهر بذمّتك ويُسجَّل مالياً عند التفعيل)</span>
            </label>
            <input type="number" value={subStr} onChange={(e) => setSubStr(e.target.value)}
              placeholder="اكتب المبلغ أو 0" dir="ltr" className="mb-3 w-full rounded-lg border border-indigo-300 px-3 py-2 text-sm" />
          </>
        )}

        {/* سحب كود المكافأة — يخصم من «المبيع» حصراً (لا يلمس «اشتراك») */}
        {fullFlow && rewardsOn && (
          <div className="mb-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-fuchsia-800">🎁 كود المكافأة <span className="text-[10px] font-normal">(يخصم من المبيع فقط)</span></span>
              {!rewardPulled ? (
                <button type="button" onClick={pullReward} disabled={nSale <= 0 || rewardBusy} className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-fuchsia-700 disabled:opacity-50">{rewardBusy ? "…" : "سحب كود المكافأة"}</button>
              ) : (
                <button type="button" onClick={() => { setRewardPulled(false); setNoCode(false); }} className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-300">إلغاء السحب — يبقى الكود للمشترك</button>
              )}
            </div>
            {noCode && !rewardPulled && <div className="mt-2 text-xs font-semibold text-slate-500">ليس لديه كود خصم</div>}
            {rewardPulled && reward && (
              <div className="mt-2 text-xs text-fuchsia-700">
                يُخصم من المبيع <b>{Math.min(reward.balance, nSale).toLocaleString("en-US")}</b> د.ع — صافي المبيع: <b>{Math.max(0, nSale - reward.balance).toLocaleString("en-US")}</b> د.ع
                {reward.balance > nSale && <span> (يبقى للمشترك {(reward.balance - nSale).toLocaleString("en-US")} د.ع)</span>}
              </div>
            )}
          </div>
        )}

        {/* الملخّص: المبيع فاتورة حقيقية، والاشتراك رقم بذمّتك يُسجَّل عند التفعيل */}
        {fullFlow && (nSale > 0 || nSub > 0) && (
          <div className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            <div>🧾 المبيع (فاتورة): <b className="text-emerald-700">{nSale.toLocaleString("en-US")}</b>{materialsTotal > 0 && nSale !== materialsTotal && <span className="text-slate-400"> (مجموع المواد {materialsTotal.toLocaleString("en-US")} — يوزَّع الفرق نسبياً)</span>}</div>
            <div>📄 اشتراك (بذمّتك — يُسجَّل عند التفعيل): <b className="text-indigo-700">{nSub.toLocaleString("en-US")}</b></div>
            <div>💰 الكلي المستلم منك عند الاكمال: <b>{(nSale + nSub).toLocaleString("en-US")}</b> د.ع</div>
          </div>
        )}

        </div>
        {/* تذييل ثابت: زر التأكيد دائماً ظاهر أسفل النافذة */}
        <div className="shrink-0 border-t border-slate-100 bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
          <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "جارٍ الإنجاز…" : "✓ تأكيد الإنجاز"}
          </button>
        </div>
      </div>
    </div>
  );
}

// نافذة أرشيف البطاقات المحصَّلة: تبقى أسبوعاً بعد التحصيل ثم تُحذف نهائياً.
// فلاتر: المكتب + تاريخ الإنجاز + الفني + النوع (تُجمع معاً). حذف نهائي يدوي للمدير فقط.
// قائمة «الفني» تُبنى من الأرشيف نفسه — فتشمل فنيي الدعم/المكاتب الأخرى الذين نفّذوا بطاقات.
function ArchiveModal({ cardTypes, offices, onClose, onChanged }: { cardTypes: CardType[]; offices: Office[]; onClose: () => void; onChanged?: () => void }) {
  type ArchCard = {
    id: number; title: string; description: string | null; kind: string; assignee: string | null;
    technicianId: number | null; amount: number | null; subAmount: number | null; serviceDetails: string | null; durationSec: number | null;
    completedAt: string | null; archivedAt: string | null; history: string | null; office: string | null;
    createdAt: string | null;
  };
  const [rows, setRows] = useState<ArchCard[]>([]);
  const [isMgr, setIsMgr] = useState(false);
  const [techOptions, setTechOptions] = useState<{ id: number; name: string }[]>([]);
  const [office, setOffice] = useState("");
  const [date, setDate] = useState("");
  const [tech, setTech] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (office) qs.set("officeId", office);
    if (date) qs.set("date", date);
    if (tech) qs.set("technicianId", tech);
    if (kind) qs.set("kind", kind);
    fetch(`/api/field/archive?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setRows(d.cards ?? []); setIsMgr(!!d.isManager); setTechOptions(d.techOptions ?? []); } })
      .finally(() => setLoading(false));
  }, [office, date, tech, kind]);
  useEffect(() => { load(); }, [load]);

  async function del(id: number) {
    if (!confirm("حذف البطاقة نهائياً من الأرشيف؟ لا يمكن التراجع.")) return;
    const r = await fetch(`/api/field/archive?id=${id}`, { method: "DELETE" });
    if (r.ok) load();
    else alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "تعذّر الحذف");
  }

  // استرجاع بطاقة من الأرشيف: تعود فعّالة لعمودها السابق ليعمل عليها الفني مجدداً
  async function restore(c: ArchCard) {
    if (!confirm(`إعادة البطاقة «${c.title}» من الأرشيف إلى عمودها باللوحة؟\nستعود فعّالة (غير منجزة) ويستطيع الفني العمل عليها مرة أخرى. تحصيل إنجازها الأول محفوظ ولا يتأثر.`)) return;
    const r = await fetch("/api/field/archive", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id }),
    });
    if (r.ok) { load(); onChanged?.(); }
    else alert(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "تعذّر الاسترجاع");
  }

  const total = rows.reduce((s, c) => s + (c.amount ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-base font-extrabold text-slate-800">🗂️ أرشيف البطاقات</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        {/* الفلاتر: المكتب / تاريخ الإنجاز / الفني / النوع */}
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          {offices.length > 1 && (
            <div>
              <label className="mb-0.5 block text-[11px] font-semibold text-slate-500">المكتب</label>
              <select value={office} onChange={(e) => setOffice(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                <option value="">— كل المكاتب —</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `مكتب ${o.id}`}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-0.5 block text-[11px] font-semibold text-slate-500">تاريخ الإنجاز</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] font-semibold text-slate-500">الفني</label>
            {/* من الأرشيف نفسه: يشمل فنيي الدعم الذين نفّذوا بطاقات هنا */}
            <select value={tech} onChange={(e) => setTech(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
              <option value="">— الكل —</option>
              {techOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] font-semibold text-slate-500">النوع</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
              <option value="">— الكل —</option>
              {cardTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          {(office || date || tech || kind) && (
            <button onClick={() => { setOffice(""); setDate(""); setTech(""); setKind(""); }} className="rounded-lg bg-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-300">إظهار الكل</button>
          )}
          <span className="mr-auto self-center text-[11px] text-slate-400">{rows.length} بطاقة · مجموع {total.toLocaleString("en-US")} د.ع</span>
        </div>

        {/* القائمة */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-400">جاري التحميل…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">لا توجد بطاقات بالأرشيف — تُحفظ هنا أسبوعاً بعد التحصيل ثم تُحذف نهائياً</div>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 bg-white">
                  <button onClick={() => setOpenId(openId === c.id ? null : c.id)} className="flex w-full flex-wrap items-center gap-1.5 px-3 py-2 text-right">
                    {/* رقم التكت ظاهر على كل بطاقة */}
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white" dir="ltr">#{c.id}</span>
                    <span className="text-sm font-semibold text-slate-800">{c.title}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${kindColor(c.kind)}`}>{c.kind}</span>
                    {c.office && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">🏢 {c.office}</span>}
                    <span className="mr-auto flex items-center gap-1.5 text-[11px] text-slate-500">
                      {c.assignee && <span>👤 {c.assignee}</span>}
                      {/* المدة المستغرقة ظاهرة على البطاقة مباشرة (بلا فتحها) */}
                      {c.durationSec != null && <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">⏱ {fmtDuration(c.durationSec)}</span>}
                      <b className="text-emerald-700">مبيع {(c.amount ?? 0).toLocaleString("en-US")}</b>
                      {(c.subAmount ?? 0) > 0 && <b className="text-indigo-700">اشتراك {(c.subAmount ?? 0).toLocaleString("en-US")}</b>}
                      {c.completedAt && <span dir="ltr">{fmtDateTime(c.completedAt)}</span>}
                    </span>
                  </button>
                  {openId === c.id && (
                    <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                      {c.description && <div className="mb-1 whitespace-pre-wrap">{c.description}</div>}
                      {c.serviceDetails && <div className="mb-1">🔧 التفاصيل: {c.serviceDetails}</div>}
                      {c.durationSec != null && <div className="mb-1">⏱ المدة: {fmtDuration(c.durationSec)}</div>}
                      {/* سجل التغييرات كاملاً — يبقى مع البطاقة بالأرشيف حتى حذفها التلقائي بعد أسبوع */}
                      {(parseHistory(c.history).length > 0 || c.createdAt) && (
                        <ul className="mb-1 mt-1 space-y-0.5 rounded bg-slate-50 p-1.5">
                          {parseHistory(c.history).slice().reverse().map((e, i) => (
                            <li key={i} className="text-[11px] text-slate-500"><span dir="ltr">{fmtDateTime(e.at)}</span> — <b>{e.by}</b>: {e.text}</li>
                          ))}
                          {c.createdAt && !parseHistory(c.history).some((e) => e.text.startsWith("إنشاء البطاقة")) && (
                            <li className="text-[11px] text-slate-500"><span dir="ltr">{fmtDateTime(c.createdAt)}</span> — 🟢 إنشاء البطاقة</li>
                          )}
                        </ul>
                      )}
                      {/* صورة العمل — محفوظة بالأرشيف وتُعرض هنا حتى الحذف التلقائي */}
                      <div className="mt-1.5 flex justify-end gap-1.5">
                        <button onClick={() => restore(c)} className="rounded bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-100">↩️ استرجاع للّوحة</button>
                        {isMgr && (
                          <button onClick={() => del(c.id)} className="rounded bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100">🗑️ حذف نهائي</button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-center text-[10px] text-slate-400">
          تُحذف بطاقات الأرشيف نهائياً بعد أسبوع من التحصيل تلقائياً{isMgr ? " — والحذف اليدوي متاح لك كمدير" : " — الحذف اليدوي للمدير فقط"}
        </div>
      </div>
    </div>
  );
}

// ═════ البند ١٠ · قائمةٌ منسدلةٌ لأزرار الترويسة (طلبُ محمد 2026-08-14) ═════
// «كثرت الأزرارُ جدّاً ⇒ قوائمُ منسدلةٌ ٢ أو ٣ مجموعاتٍ بحسب الفئة والاختصاص، وعنوانُ
//  القائمة يخصّ ما بداخلها».
//
// 🔑 **والشارةُ على العنوان شرطٌ لا زينة**: معلَّقٌ داخل قائمةٍ مطويّةٍ = شارةٌ لا تُرى،
//   ومَن لا يرى لا ينتبه — وهي بعينها شكوى محمد في بند الإجازة الزمنيّة («المديرُ لم
//   ينتبه للإشعار»). فمجموعُ معلَّقات الأبناء يظهر على العنوان **وهي مطويّة**.
function FieldMenu({ title, badge = 0, children }: { title: string; badge?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  // تُغلَق بالنقر خارجها وبـEscape — فقائمةٌ عالقةٌ مفتوحةٌ تحجب اللوحةَ تحتها
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="ftb relative" aria-expanded={open}>
        {title} <span className="text-[10px] opacity-70">{open ? "▲" : "▼"}</span>
        {badge > 0 && <i className="fbadge">{badge}</i>}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[210px] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/** عنصرُ قائمةٍ: زرٌّ أو رابط — وشارتُه تبقى ظاهرةً داخل القائمة أيضاً. */
function FieldMenuItem(
  { children, onClick, href, badge = 0 }:
  { children: React.ReactNode; onClick?: () => void; href?: string; badge?: number },
) {
  const cls = "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-right text-sm font-semibold text-ink-2 transition hover:bg-ground hover:text-orange-d";
  const inner = (
    <>
      <span>{children}</span>
      {badge > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
    </>
  );
  if (href) return <a href={href} className={cls}>{inner}</a>;
  return <button onClick={onClick} className={cls}>{inner}</button>;
}
