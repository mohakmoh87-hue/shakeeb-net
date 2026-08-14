import { prisma } from "@/lib/prisma";
import { getEffectiveTemplateFull } from "@/lib/smsTemplates";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";

// إرسال رسالة القرض للمشترك — صامت وغير معطِّل (لو فشل يبقى القرض ممنوحاً وتُسجَّل الرسالة FAILED).
// يُستدعى بـ void بعد نجاح المنح، تماماً كرسالة التفعيل.
export async function sendLoanMessage(opts: {
  subscriberId: number;
  officeId: number | null; // مكتب المشترك (لجلسة واتساب المكتب) — عزل: مكتب المشترك وحده
  agentId: number | null; // وكيل المشترك (لاختيار القالب الصحيح للمستأجر)
  phone: string | null;
  waEnabled: boolean; // subscriber.waEnabled (تعطيل واتساب لهذا المشترك)
  officeName: string | null;
  officeWaEnabled: string | null; // tower.waEnabled ("0" = واتساب المكتب مطفأ)
  name: string | null;
  netUser: string | null;
  amount: number;
  expiryVirtual: Date | null;
  createdByUser?: string | null;
}): Promise<void> {
  try {
    if (opts.waEnabled === false) return; // المشترك أوقف واتساب
    if (!opts.phone) return;
    if (opts.officeWaEnabled === "0") return; // واتساب المكتب مطفأ
    const tpl = await getEffectiveTemplateFull("loan", opts.agentId, opts.officeId);
    if (!tpl) return; // القالب معطَّل أو غائب
    const text = renderTemplate(tpl.text, {
      "الاسم": opts.name ?? "",
      "اليوزر": opts.netUser ?? "",
      "المبلغ": Number(opts.amount || 0).toLocaleString("en-US"),
      "تاريخ_الانتهاء": opts.expiryVirtual ? formatDate(opts.expiryVirtual) : "",
      "المكتب": opts.officeName ?? "SHAKEEB",
    });
    const res = await sendViaProvider("WHATSAPP", opts.phone, text, opts.officeId, tpl.image);
    await prisma.message.create({
      data: {
        channel: "WHATSAPP",
        subscriberId: opts.subscriberId,
        phone: opts.phone,
        text,
        status: res.ok ? "SENT" : "FAILED",
        error: res.error ?? null,
        createdByUser: opts.createdByUser ?? null,
        agentId: opts.agentId ?? null, // عزل سجلّ الرسائل بالوكيل (كان يُمرَّر للقالب ولا يُكتب)
      },
    });
  } catch {
    /* الإرسال لا يُعطّل المنح أبداً */
  }
}
