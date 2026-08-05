import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// حالة اتصال واتساب مكتب محدّد + رمز QR للربط (?officeId=)
// على الوكيل المحلي (RUN_WORKER=1): يشغّل واتساب محلياً ويقرأ الحالة مباشرةً.
// على الموقع (Vercel، بلا متصفّح): يطلب الاتصال من الوكيل ويقرأ الحالة/الـQR من السحابة.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!officeId) return NextResponse.json({ error: "حدّد المكتب" }, { status: 400 });
  // عزل المستأجر: مكتب يتبع وكيل المستخدم فقط (ownsTower يقيّد المدير بمكاتب وكيله لا كل النظام)
  if (!(await ownsTower(session, officeId))) {
    return NextResponse.json({ error: "لا يمكنك ربط واتساب مكتب آخر" }, { status: 403 });
  }

  const toImg = (qr: string | null | undefined) =>
    qr ? QRCode.toDataURL(qr, { margin: 1, width: 320 }).catch(() => null) : Promise.resolve(null);

  // حاسبة مالكة الجلسة (على قرصها) تستضيف واتساب المكتب. حاسبةٌ لا تملك الجلسة يجب ألّا تبدأ عميلاً
  // لمكتبٍ مستضاف على حاسبة أخرى (تنشر "منقطع" فوق الحالة الحقيقية)، لكن يُسمح لها ببدء الربط (مسح QR)
  // إن لم يكن للمكتب مضيفٌ حيٌّ في أي مكان — كي يمكن ربط مكتب جديد من حاسبته.
  if (process.env.RUN_WORKER === "1") {
    const { hostsOfficeLocally } = await import("@/lib/whatsapp");
    let allowStart = hostsOfficeLocally(officeId);
    if (!allowStart) {
      const sess = await prisma.waSession.findUnique({ where: { towerId: officeId }, select: { state: true } });
      const liveElsewhere = sess != null && ["ready", "qr", "authenticated", "starting"].includes(sess.state ?? "");
      allowStart = !liveElsewhere; // لا مضيف حيّ ⇒ اسمح ببدء الربط هنا
    }
    if (allowStart) {
      const { startWhatsApp, whatsappStatus } = await import("@/lib/whatsapp");
      await startWhatsApp(officeId);
      const st = whatsappStatus(officeId);
      return NextResponse.json({ state: st.state, qrImage: await toImg(st.qr), error: st.error, hint: null });
    }
    // مضيفٌ حيّ على حاسبة أخرى: لا تُشغّل محلياً — اقرأ الحالة المنشورة (كالموقع)
  }

  // الموقع (أو عاملٌ غير قائد): سجّل طلب اتصال ليلتقطه القائد، واقرأ آخر حالة/QR نشرها في السحابة
  await prisma.waSession.upsert({
    where: { towerId: officeId },
    update: { requestedAt: new Date() },
    create: { towerId: officeId, requestedAt: new Date(), state: "starting" },
  });
  const sess = await prisma.waSession.findUnique({ where: { towerId: officeId } });

  // ===== الحالة المنشورة قد تكون **مجمّدة** (تصحيح 2026-08-05) =====
  // صفّ الجلسة لا يُكتب إلا من حاسبة المكتب. فإذا أُطفئت الحاسبة بقي آخر ما كتبته
  // إلى الأبد: «متصل ✓» بعد ١٩ ساعة من انطفاء حاسبة الشهداء، ورمز QR عمره ١٦ يوماً
  // في المواصلات لا يُمسَح بشيء. القائمة (readOfficeStates) كانت تكشف هذا الجمود منذ
  // ٤ آب، أما هذه الشاشة — وهي **الوحيدة التي تُظهر رمز الربط** — فكانت تصدّق الصفّ
  // كما هو. فيرى المستخدم «متصل» فلا رمز يُعرض له ولا سبب يُفهم.
  // الآن: الحالة تُصدَّق فقط إن كانت حاسبة المكتب تنبض والصفّ حديثاً، ويُقال للمستخدم
  // صراحةً ما يفعله — لأن الرمز لا يولد إلا على حاسبة المكتب، لا في السحابة.
  const WORKER_ALIVE_MS = 90_000; // نبضة العامل كل ~٣٠ث
  const READY_FRESH_MS = 5 * 60 * 1000; // «متصل» تُجدَّد كل دورة ما دام العميل حيّاً
  const LINKING_FRESH_MS = 2 * 60 * 1000; // رمز QR يتبدّل كل ~٢٠ث — قِدَمُه يعني حاسبةً متوقّفة

  const workers = await prisma.hybridWorker.findMany({
    where: { blocked: false, OR: [{ towerId: officeId }, ...(sess?.hostMachineId ? [{ machineId: sess.hostMachineId }] : [])] },
    select: { machineId: true, name: true, lastSeen: true, approved: true, towerId: true },
  });
  const alive = (w: { lastSeen: Date | null }) => w.lastSeen != null && Date.now() - w.lastSeen.getTime() < WORKER_ALIVE_MS;
  const host = sess?.hostMachineId ? workers.find((w) => w.machineId === sess.hostMachineId) ?? null : null;
  // حاسبة المكتب: المستضيفة إن كانت حيّة، وإلا المربوطة بالمكتب (هي التي يشغّلها المستخدم)
  const bound = workers.filter((w) => w.towerId === officeId).sort((a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0))[0] ?? null;
  const machine = bound ?? host;
  const machineOnline = machine != null && machine.approved && alive(machine);
  const ageMs = sess?.updatedAt ? Date.now() - sess.updatedAt.getTime() : Infinity;
  const mins = Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : null;
  const since = mins == null ? "" : mins < 60 ? `${mins} دقيقة` : mins < 1440 ? `${Math.round(mins / 60)} ساعة` : `${Math.round(mins / 1440)} يوم`;
  const machineLabel = machine?.name ? `«${machine.name}»` : "حاسبة المكتب";

  let state = sess?.state ?? "starting";
  let qr = sess?.qr ?? null;
  let hint: string | null = null;

  const hostFrozen = state === "ready" && (!host || !alive(host) || ageMs > READY_FRESH_MS);
  const linkFrozen = ["qr", "starting", "authenticated"].includes(state) && ageMs > LINKING_FRESH_MS;
  if (hostFrozen || linkFrozen) {
    state = "disconnected";
    qr = null;
    hint = hostFrozen
      ? `الحالة «متصل» قديمة منذ ${since}: ${machineLabel} لا تُرسل نبضة، فالاتصال منقطع فعلياً. شغّل حاسبة المكتب وانتظر دقيقة ليظهر رمز الربط.`
      : `رمز الربط السابق انتهى (عمره ${since}) لأن ${machineLabel} توقّفت. شغّلها وانتظر دقيقة ليظهر رمز جديد.`;
  } else if (state === "disconnected" && !machineOnline) {
    hint = `${machineLabel} غير متصلة الآن — ورمز الربط لا يُولَّد إلا عليها. شغّلها وتأكّد أن برنامج ShakeebNet يعمل، ثم انتظر دقيقة.`;
  } else if (state === "qr") {
    hint = "امسح الرمز خلال دقيقة — يتجدّد تلقائياً.";
  }

  return NextResponse.json({
    state,
    qrImage: await toImg(qr),
    error: sess?.error ?? null,
    hint,
    machine: machine ? { name: machine.name, online: machineOnline, minutesAgo: machine.lastSeen ? Math.round((Date.now() - machine.lastSeen.getTime()) / 60000) : null } : null,
  });
}
