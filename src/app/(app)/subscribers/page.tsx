import { redirect } from "next/navigation";

// جدول المشتركين صار جزءاً من الشاشة الرئيسية (الطراز الجديد — ب2).
// تبقى هذه الصفحة تحويلة حتى لا ينكسر أي رابط قديم؛ /subscribers/sas4 مستقلة وباقية.
export default function SubscribersPage() {
  redirect("/dashboard");
}
