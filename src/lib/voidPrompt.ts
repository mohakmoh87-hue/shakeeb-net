// نافذة تأكيد حذف وصل ذي أثر مالي — ثلاثة خيارات صريحة (تتفادى لبس Cancel):
//   نعم  → يؤثّر على العمليات (إرجاع عكسي كامل)      ⇒ { reverse: true }
//   كلا  → لا يؤثّر على العمليات (حذف الوصل فقط)      ⇒ { reverse: false }
//   تراجع → يغلق النافذة بلا أي حذف أو تعديل          ⇒ null
// تُبنى بعناصر DOM مباشرةً (تعمل من أي صفحة بلا مزوّد)، وتُعيد Promise.
//
// ═════ ب-٥-أ · النصُّ كان يَعِد بما لا يقع — والفرقُ بين المسارَين حقيقيّ ═════
// 🔴 نافذةٌ واحدةٌ كانت تسأل «هل تريد أن يؤثّر الحذف على المبالغ والتقرير؟» لثلاثة
//   مسارات — **ومعناها يختلف بينها اختلافاً ماليّاً**:
//   · **فاتورة** و**وصل تفعيل**: الورقةُ تُحذف والمالُ **يبقى** إن اخترتَ «كلا» ⇒ النصُّ صادق.
//   · **قيدُ الصندوق** (`/api/money/:id/void`): القيدُ **هو** المال. فـ`isDeleted = true`
//     خارج كتلة `reverse` ⇒ المبلغُ يخرج من الصندوق والتقرير **في الحالتَين**، بينما
//     الزرُّ يقول «كلا — لا يؤثّر على المبالغ». فيَحذف المديرُ قيدَ فاتورةٍ مقبوضةٍ واثقاً
//     أنّ رصيدَه لن يتغيّر، فينقص الصندوقُ وتبقى الفاتورةُ مقبوضةً ⇒ **فارقةٌ لا تُفسَّر**.
// 🔑 والسلوكُ نفسُه صحيحٌ في المسارَين: حذفُ قيدٍ من الصندوق **يجب** أن يُنقص الصندوق.
//   فالخطأُ في **النصّ** لا في الفعل ⇒ يُقال للمدير ما يحدث فعلاً، ويُسأل عن السؤال
//   الحقيقيِّ وحدَه: هل يُرجَع أثرُ القيد على العمليّة المرتبطة أيضاً؟
export type VoidKind = "paper" | "money";

export function askVoidEffect(
  label = "هذا الوصل",
  // "paper" (الافتراضيّ) = فاتورةٌ/وصلُ تفعيل: المالُ يبقى مع «كلا».
  // "money" = قيدُ صندوق: المبلغُ يخرج في الحالتَين، والسؤالُ عن العمليّة المرتبطة.
  kind: VoidKind = "paper",
): Promise<{ reverse: boolean } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(null); return; }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

    const overlay = document.createElement("div");
    overlay.dir = "rtl";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";

    const box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px;box-shadow:0 12px 45px rgba(0,0,0,.25);font-family:inherit;";
    // النصُّ يقول ما يحدث فعلاً في كلّ مسار — لا صيغةً واحدةً تصدُق في أحدهما وتكذب في الآخر
    const money = kind === "money";
    const ask = money
      ? "المبلغُ يخرج من الصندوق والتقرير <b>في الحالتَين</b> — فالقيدُ هو المال."
        + "<br>والسؤال: هل يُرجَع أثرُه على العمليّة المرتبطة أيضاً؟"
      : "هل تريد أن يؤثّر الحذف على المبالغ والتقرير؟";
    const yes = money
      ? "نعم — أرجِعْ أثرَها (تُحذف الفاتورة · يعود الدَّينُ على المشترك · تعود الكميّة للمخزن)"
      : "نعم — يؤثّر على العمليات (إرجاع عكسي كامل)";
    const no = money
      ? "كلا — احذف القيدَ فقط (تبقى الفاتورة/الدَّين كما هي)"
      : "كلا — لا يؤثّر على العمليات (حذف الوصل فقط)";
    box.innerHTML =
      `<div style="font-weight:800;font-size:17px;color:#1e293b;margin-bottom:6px;">🗑️ حذف ${esc(label)}</div>` +
      `<div style="font-size:13px;color:#64748b;margin-bottom:18px;line-height:1.7;">${ask}</div>` +
      `<div style="display:flex;flex-direction:column;gap:9px;">` +
        `<button data-c="yes" style="border:0;border-radius:11px;padding:12px;font-weight:700;font-size:14px;cursor:pointer;color:#fff;background:#059669;">${yes}</button>` +
        `<button data-c="no" style="border:0;border-radius:11px;padding:12px;font-weight:700;font-size:14px;cursor:pointer;color:#fff;background:#dc2626;">${no}</button>` +
        `<button data-c="cancel" style="border:1px solid #cbd5e1;border-radius:11px;padding:12px;font-weight:600;font-size:14px;cursor:pointer;color:#475569;background:#f1f5f9;">تراجع (بلا حذف ولا تعديل)</button>` +
      `</div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const done = (result: { reverse: boolean } | null) => {
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);

    box.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        const c = (b as HTMLButtonElement).dataset.c;
        done(c === "yes" ? { reverse: true } : c === "no" ? { reverse: false } : null);
      });
    });
    // النقر خارج الصندوق = تراجع
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
  });
}
