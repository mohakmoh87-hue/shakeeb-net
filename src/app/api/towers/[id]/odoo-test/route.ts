import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownsTower } from "@/lib/guard";
import { decryptSecret } from "@/lib/secretbox";
import { odooTestConnection, odooHostAllowed } from "@/lib/odoo";

// اختبار اتصال أودو لمكتب — **سحابيّ، لمرّة واحدة عند الإعداد** (قرار محمد: مقبول لأنّه لا يتكرّر).
// متاحٌ للمدير (أيّ مكتب من وكيله) وللمستخدم (مكتبه فقط) عبر ownsTower — لا يخصّ المدير حصراً كالقروض.
// يقبل بيانات النموذج الحاليّة؛ وإن غابت كلمة المرور يستعمل المخزّنة (المفكوكة).
const schema = z.object({
  odooUser: z.string().nullable().optional(),
  odooPass: z.string().nullable().optional(),
  odooUrl: z.string().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const { id } = await params;
  const towerId = Number(id);
  if (!(await ownsTower(session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const parsed = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  // ===== أ-٢٣ · مصدرُ البيانات المحفوظة: **اللوحةُ** إن طُلبت، وإلّا أعمدةُ المكتب =====
  // 🔴 ولولا هذا لكان تركُ كلمةِ المرور فارغةً (أي «أبقِ القديمة») في نافذةِ اللوحة الثانية
  // يختبر كلمةَ **المكتب** فيُعطي نتيجةً خاطئةً صامتة — وهو أسوأُ من خطأٍ ظاهر.
  const panelRaw = new URL(request.url).searchParams.get("panelId");
  let panelId: number | null = null;
  if (panelRaw) {
    const n = Number(panelRaw);
    if (!Number.isInteger(n)) return NextResponse.json({ error: "لوحة غير صحيحة" }, { status: 400 });
    // 🔒 واللوحةُ يجب أن تتبع هذا المكتب
    const owned = await prisma.sasPanel.findFirst({ where: { id: n, towerId, isDeleted: false }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "اللوحة لا تتبع هذا المكتب" }, { status: 403 });
    panelId = n;
  }
  const sel = { odooUser: true, odooPass: true, odooUrl: true } as const;
  const saved = panelId != null
    ? await prisma.sasPanel.findUnique({ where: { id: panelId }, select: sel })
    : await prisma.tower.findUnique({ where: { id: towerId }, select: sel });
  const odooUser = (parsed.data.odooUser ?? saved?.odooUser ?? "").trim();
  const odooPass = parsed.data.odooPass && parsed.data.odooPass !== ""
    ? parsed.data.odooPass
    : (decryptSecret(saved?.odooPass) ?? "");
  const odooUrl = (parsed.data.odooUrl ?? saved?.odooUrl ?? "").trim() || null;
  // مضيفٌ من سوبر سيل حصراً — وإلّا كان هذا المسار بابَ تسريبٍ لكلمة مرور أودو بطلبٍ واحد
  if (odooUrl && !odooHostAllowed(odooUrl)) {
    return NextResponse.json({ ok: false, message: "رابط أودو غير مسموح — يجب أن يكون على نطاق supercell.iq" });
  }
  if (!odooUser || !odooPass) {
    return NextResponse.json({ ok: false, message: "أدخل اسم المستخدم وكلمة المرور أولاً" });
  }

  const res = await odooTestConnection(odooUrl, odooUser, odooPass);
  return NextResponse.json(res);
}
