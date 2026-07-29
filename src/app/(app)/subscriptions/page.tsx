import { redirect } from "next/navigation";

// كانت صفحة يتيمة (لا يشير إليها رابط) — حلّ محلّها «سجل الوصولات» العام
// بكل مزاياها (إعادة طباعة، حذف عكسي، فرز، بحث) وزيادة. تبقى تحويلة.
export default function SubscriptionsPage() {
  redirect("/receipts");
}
