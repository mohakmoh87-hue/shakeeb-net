import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownsTower } from "@/lib/guard";
import { decryptSecret } from "@/lib/secretbox";
import { odooLogin, odooHostAllowed } from "@/lib/odoo";

// إعداد ربط أودو لمكتب — **للمدير والمستخدم** (كلٌّ لمكتبه) عبر ownsTower.
// السرّ (odooPass) يُشفَّر؛ ولا يُكشف إطلاقاً في القراءة (فقط hasOdooCreds).

const schema = z.object({
  odooEnabled: z.string().nullable().optional(), // "0" | "1"
  odooUser: z.string().nullable().optional(),
  odooPass: z.string().nullable().optional(), // فارغ = أبقِ القديم
  odooUrl: z.string().nullable().optional(),
  // مهلة سوبر سيل (طلب محمد 2026-08-09) — ميزتان بمفتاحين
  odooSlaAlarm: z.string().nullable().optional(), // الميزة ١ (إنذارات) "0" | "1"
  odooSlaAlarmMin: z.union([z.string(), z.number()]).nullable().optional(),
  odooSlaTechText: z.string().nullable().optional(),
  odooSlaAuto: z.string().nullable().optional(), // الميزة ٢ (إرسال) "0" | "1" — بإذن المالك
  odooSlaSendMin: z.union([z.string(), z.number()]).nullable().optional(),
  odooSlaNote: z.string().nullable().optional(),
  odooSlaWaText: z.string().nullable().optional(),
});

// عتبةٌ بالدقائق: رقمٌ معقول أو null (فارغ = الافتراضيّ في الكود)
function minutesOrNull(v: string | number | null | undefined): number | null | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n) || n < 5 || n > 1440) return undefined; // قيمةٌ سخيفة ⇒ لا تُكتَب
  return n;
}

async function gate(params: Promise<{ id: string }>, request?: Request) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const { id } = await params;
  const towerId = Number(id);
  if (!(await ownsTower(session, towerId))) {
    return { error: NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 }) };
  }
  // أ-٢٣ · `?panelId=` = بياناتُ أودو **لوحةٍ بعينها** من لوحات هذا المكتب. فارغٌ = أعمدةُ
  // المكتب (السلوكُ القديم بالضبط).
  // 🔒 واللوحةُ يجب أن تتبع هذا المكتب — وإلّا عُدِّلت لوحةُ مكتبٍ آخرَ بتمرير معرّف.
  let panelId: number | null = null;
  if (request) {
    const raw = new URL(request.url).searchParams.get("panelId");
    if (raw) {
      const n = Number(raw);
      if (!Number.isInteger(n)) return { error: NextResponse.json({ error: "لوحة غير صحيحة" }, { status: 400 }) };
      const owned = await prisma.sasPanel.findFirst({ where: { id: n, towerId, isDeleted: false }, select: { id: true } });
      if (!owned) return { error: NextResponse.json({ error: "اللوحة لا تتبع هذا المكتب" }, { status: 403 }) };
      panelId = n;
    }
  }
  return { session, towerId, panelId };
}

// الحالة (للشارة الديناميّة في «إدارة الفنيين») — بلا كشف السرّ
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params, _request);
  if (g.error) return g.error;
  const t = await prisma.tower.findUnique({
    where: { id: g.towerId! },
    select: {
      odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true, odooLastOk: true, odooLastError: true,
      odooSlaAlarm: true, odooSlaTechText: true,
      odooSlaAuto: true, odooSlaArmedAt: true, odooSlaAlarmMin: true, odooSlaSendMin: true, odooSlaNote: true, odooSlaWaText: true,
    },
  });
  if (!t) return NextResponse.json({ error: "المكتب غير موجود" }, { status: 404 });
  // إذن مالك النظام للميزة ٢ — بلا هذا الإذن لا تُعرَض الواجهة له شيئاً منها
  const agentRow = g.session?.agentId != null
    ? await prisma.agent.findUnique({ where: { id: g.session.agentId }, select: { odooSlaSendAllowed: true } })
    : null;
  // أ-٢٣ · بياناتُ الاعتماد من **اللوحة** إن طُلبت. وأمّا إعداداتُ مهلة سوبر سيل (SLA) فتبقى
  // **على مستوى المكتب** — فهي سياسةُ تذاكرِ المكتب لا خصوصيّةَ حسابٍ في أودو، ومكتبٌ واحدٌ
  // بلوحتَين له سياسةُ إنذارٍ واحدة.
  const p = g.panelId != null
    ? await prisma.sasPanel.findUnique({
        where: { id: g.panelId },
        select: { odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true, odooLastOk: true, odooLastError: true, label: true },
      })
    : null;
  const cred = p ?? t;
  return NextResponse.json({
    panelId: g.panelId,
    panelLabel: p?.label ?? null,
    odooEnabled: cred.odooEnabled ?? "0",
    hasOdooCreds: !!(cred.odooUser && cred.odooPass),
    odooUser: cred.odooUser ?? null, // اسم المستخدم فقط (مكتبه) — لا كلمة المرور أبداً
    odooUrl: cred.odooUrl ?? null,
    odooLastOk: cred.odooLastOk,
    odooLastError: cred.odooLastError,
    // الميزة ١ (إنذارات) — للكلّ
    odooSlaAlarm: t.odooSlaAlarm ?? "0",
    odooSlaAlarmMin: t.odooSlaAlarmMin,
    odooSlaTechText: t.odooSlaTechText,
    // الميزة ٢ (إرسال) — لا يُعاد منها شيءٌ بلا إذن المالك
    odooSlaSendAllowed: !!agentRow?.odooSlaSendAllowed,
    ...(agentRow?.odooSlaSendAllowed
      ? {
          odooSlaAuto: t.odooSlaAuto ?? "0",
          odooSlaArmedAt: t.odooSlaArmedAt,
          odooSlaSendMin: t.odooSlaSendMin,
          odooSlaNote: t.odooSlaNote,
          odooSlaWaText: t.odooSlaWaText,
        }
      : {}),
  });
}

// حفظ الإعداد. عند التفعيل بوجود بيانات ⇒ نجرّب دخولاً واحداً (سحابيّ، لمرّة) لضبط الشارة فوراً.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params, request);
  if (g.error) return g.error;
  const towerId = g.towerId!;

  const parsed = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.odooEnabled != null) data.odooEnabled = parsed.data.odooEnabled;
  if (parsed.data.odooUser != null) data.odooUser = parsed.data.odooUser.trim();
  // المضيف مقيَّدٌ بسوبر سيل: بلا هذا القيد يُسلّم الخادم كلمة مرور أودو لأيّ موقعٍ يكتبه المستخدم
  if (parsed.data.odooUrl != null) {
    const url = parsed.data.odooUrl.trim();
    if (url && !odooHostAllowed(url)) {
      return NextResponse.json({ error: "رابط أودو غير مسموح — يجب أن يكون على نطاق supercell.iq" }, { status: 400 });
    }
    data.odooUrl = url || null;
  }
  // كلمة المرور: الفراغ لا يمحو القديم؛ وإلا تُخزَّن نصّاً صريحاً (كـSAS) ليقرأها العامل بلا مفتاح
  if (parsed.data.odooPass != null && parsed.data.odooPass !== "") data.odooPass = parsed.data.odooPass;
  // ===== مهلة سوبر سيل — الميزة ١ (إنذارات): لكلّ الوكلاء بلا إذن =====
  const alarmMin = minutesOrNull(parsed.data.odooSlaAlarmMin);
  if (alarmMin !== undefined) data.odooSlaAlarmMin = alarmMin;
  if (parsed.data.odooSlaTechText != null) data.odooSlaTechText = parsed.data.odooSlaTechText.trim() || null;
  const alarmOn = parsed.data.odooSlaAlarm != null ? parsed.data.odooSlaAlarm === "1" : null;
  if (alarmOn != null) data.odooSlaAlarm = alarmOn ? "1" : "0";

  // ===== الميزة ٢ (إرسال): بإذن مالك النظام حصراً، ولا تعمل بلا الميزة ١ =====
  const agentRow = g.session?.agentId != null
    ? await prisma.agent.findUnique({ where: { id: g.session.agentId }, select: { odooSlaSendAllowed: true } })
    : null;
  const sendAllowed = !!agentRow?.odooSlaSendAllowed;
  if (sendAllowed) {
    const sendMin = minutesOrNull(parsed.data.odooSlaSendMin);
    if (sendMin !== undefined) data.odooSlaSendMin = sendMin;
    if (parsed.data.odooSlaNote != null) data.odooSlaNote = parsed.data.odooSlaNote.trim() || null;
    if (parsed.data.odooSlaWaText != null) data.odooSlaWaText = parsed.data.odooSlaWaText.trim() || null;
    // بوّابة التسليح: **لحظة** تشعيل الإرسال تُختَم، فما سُحب قبلها لا يُرسَل له تلقائيّاً أبداً.
    // هذا وحده ما يمنع رشقةً جماعيّةً لتذاكرَ قديمةٍ لحظة التشعيل (رسائل لا رجعة فيها).
    if (parsed.data.odooSlaAuto != null) {
      const cur = await prisma.tower.findUnique({ where: { id: towerId }, select: { odooSlaAuto: true, odooSlaAlarm: true } });
      // الإرسال لا يُشعَل إلّا والإنذارات مُشعَلة (المطلوب الآن أو المحفوظ سابقاً)
      const alarmEffective = alarmOn ?? cur?.odooSlaAlarm === "1";
      const want = parsed.data.odooSlaAuto === "1" && alarmEffective;
      data.odooSlaAuto = want ? "1" : "0";
      if (want && cur?.odooSlaAuto !== "1") data.odooSlaArmedAt = new Date(); // تشعيلٌ جديد ⇒ ختمٌ جديد
      if (!want) data.odooSlaArmedAt = null;
    }
  }
  // إطفاء الإنذارات — أو إطفاء ربط أودو نفسه — يُطفئ الإرسال قهراً (الإرسال مبنيٌّ على حسابها)
  if (alarmOn === false || parsed.data.odooEnabled === "0") { data.odooSlaAuto = "0"; data.odooSlaArmedAt = null; }

  // ===== أ-٢٣ · فصلُ الكتابة: بياناتُ الاعتماد للوحة، وسياسةُ المهلة للمكتب =====
  // فبياناتُ أودو خصوصيّةُ **حسابٍ** (لكلّ لوحةِ ساسٍ بوّابتُها)، وأمّا إعداداتُ المهلة (SLA)
  // فسياسةُ **تذاكرِ المكتب** — ومكتبٌ واحدٌ بلوحتَين له سياسةُ إنذارٍ واحدة لا اثنتان.
  const CRED = ["odooEnabled", "odooUser", "odooUrl", "odooPass"] as const;
  const panelId = g.panelId;
  const credData: Record<string, unknown> = {};
  const towerData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (panelId != null && (CRED as readonly string[]).includes(k)) credData[k] = v;
    else towerData[k] = v;
  }
  if (Object.keys(towerData).length) await prisma.tower.update({ where: { id: towerId }, data: towerData });

  // ═════ أ-٢٣ · مرآةُ أودو مع **اللوحة الأولى** (كمرآة الساس) ═════
  // اللوحةُ الأولى هي المكتبُ نفسُه، ومزامنةُ أودو تقرأ **أعمدةَ المكتب** لها. فحقولُ أودو على
  // صفّها كانت «تُكتَب ولا تُقرَأ». وتُنسَخ هنا كي يبقى الصفّان قولاً واحداً، ولئلّا يُعدّلها
  // المديرُ من محرِّر اللوحات فيظنّها فعلت شيئاً.
  // ⚠️ و**ما تغيّر فعلاً وحدَه** يُنسَخ: نموذجُ أودو يُرسل حقولَه كاملةً، فنسخُ كلّ مُرسَلٍ كان
  //   يطمس ما لم يُعدَّل (وهي العلّةُ التي اصطادها التدقيقُ في مرآة الساس).
  const OD = ["odooEnabled", "odooUrl", "odooUser", "odooPass"] as const;
  const mirror: Record<string, unknown> = {};
  for (const k of OD) {
    if (!(k in towerData)) continue;
    if (k === "odooPass" && !towerData[k]) continue; // الفارغةُ لا تُنسَخ — لا تُطمَس عاملة
    mirror[k] = towerData[k];
  }
  if (Object.keys(mirror).length) {
    await prisma.sasPanel.updateMany({
      where: { towerId, isPrimary: true, isDeleted: false },
      data: mirror,
    }).catch(() => {}); // المرآةُ زينةٌ لا شرط — لا تُفشِل حفظَ المكتب أبداً
  }
  if (panelId != null && Object.keys(credData).length) await prisma.sasPanel.update({ where: { id: panelId }, data: credData });

  // تفعيلٌ ببيانات كاملة ⇒ دخولٌ تجريبيّ لمرّة لضبط الشارة (أخضر/أحمر) و uid فوراً.
  // 🔴 والاختبارُ يجري على **بيانات الجهة التي كُتبت** — ولولا ذلك اختبرنا حساباً واختمنا شارةَ آخر.
  const sel = { odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true } as const;
  const after = panelId != null
    ? await prisma.sasPanel.findUnique({ where: { id: panelId }, select: sel })
    : await prisma.tower.findUnique({ where: { id: towerId }, select: sel });
  if (after?.odooEnabled === "1" && after.odooUser && after.odooPass) {
    const pass = decryptSecret(after.odooPass) ?? "";
    const okData = (uid: number) => ({ odooLastOk: new Date(), odooUid: uid, odooLastError: null });
    const errData = (m: string) => ({ odooLastOk: null, odooLastError: m.slice(0, 200) });
    try {
      const s = await odooLogin(after.odooUrl, after.odooUser, pass);
      if (panelId != null) await prisma.sasPanel.update({ where: { id: panelId }, data: okData(s.uid) });
      else await prisma.tower.update({ where: { id: towerId }, data: okData(s.uid) });
    } catch (e) {
      const m = (e as Error).message ?? "فشل الدخول";
      if (panelId != null) await prisma.sasPanel.update({ where: { id: panelId }, data: errData(m) });
      else await prisma.tower.update({ where: { id: towerId }, data: errData(m) });
    }
  }

  const selOut = { odooEnabled: true, odooUser: true, odooPass: true, odooUrl: true, odooLastOk: true, odooLastError: true } as const;
  const t = panelId != null
    ? await prisma.sasPanel.findUnique({ where: { id: panelId }, select: selOut })
    : await prisma.tower.findUnique({ where: { id: towerId }, select: selOut });
  return NextResponse.json({
    ok: true,
    panelId,
    odooEnabled: t?.odooEnabled ?? "0",
    hasOdooCreds: !!(t?.odooUser && t?.odooPass),
    odooLastOk: t?.odooLastOk ?? null,
    odooLastError: t?.odooLastError ?? null,
  });
}
