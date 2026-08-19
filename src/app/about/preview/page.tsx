"use client";

import { useEffect } from "react";
import DailyReportCard from "@/components/DailyReportCard";
import TrialFmCard from "@/components/TrialFmCard";

// ═════════ 🧪 معاينةُ رئيسيّة التجربة ببياناتٍ تمثيليّة (طلب محمد 2026-08-19) ═════════
//
// «ارجو منك هذه المره فتح صفحة معاينة لك باي طريقة». هذه الصفحةُ تعرض **المكوّنات
// الحقيقيّة نفسَها** (DailyReportCard وTrialFmCard) بأرقامٍ تمثيليّةٍ ثابتة، فلا
// تحتاج قاعدةً ولا جلسةً — فتُفحَص محلّيّاً وعلى الموقع قبل كلّ نشر، ويُقارَن
// شكلُها بالنموذج المعتمَد مباشرة.
//
// لا مالَ حقيقيّاً هنا ولا بياناتِ أحد — أرقامٌ مخترعةٌ للفحص البصريّ فقط.
export default function TrialPreviewPage() {
  useEffect(() => {
    // تُشعَل التجربةُ على هذه الصفحة وحدَها (الوسمُ يسقط عند مغادرتها بلا كعكة)
    document.documentElement.setAttribute("data-app-trial", "");
  }, []);

  return (
    <div className="nst nst-fill min-h-screen bg-ground p-4" style={{ display: "grid", gap: 17, alignContent: "start" }}>
      <TrialFmCard demo={{
        done: 3, left: 21, odoo: 1,
        leader: { name: "حسين جبّار", points: 39.8 },
        subs: { active: 5386, online: 3120 },
      }} />
      <div className="row2 max-[1050px]:!grid-cols-1">
        <div className="card" id="subs-board">
          <div className="ch">
            <div data-app-bar className="hbtns">
              <button className="gbtn">🔄 استيراد من SAS4</button>
              <button className="gbtn">📑 ديون المشتركين</button>
              <button className="gbtn">💬 ارسال رسالة للكل</button>
              <button className="obtn">+ مشترك جديد</button>
            </div>
          </div>
          <div className="searchbar"><span className="sicon">🔍</span><input className="sq" placeholder="بحث بالاسم أو رقم الهاتف أو اليوزر" readOnly /></div>
          <div className="tscroll">
            <table className="tbl subs">
              <thead><tr><th>اسم المشترك</th><th>اليوزر</th><th>رقم الهاتف</th><th>المكتب</th></tr></thead>
              <tbody>
                <tr><td>أحمد كاظم</td><td>bg-17-10-2</td><td>07701234567</td><td>الشهداء</td></tr>
                <tr><td>مصطفى علي</td><td>sh-04-1</td><td>07512229876</td><td>الرسالة</td></tr>
                <tr><td>حسين جبّار</td><td>rs-22-9</td><td>07803331122</td><td>الشهداء</td></tr>
                <tr><td>ليث سعد</td><td>bg-09-3</td><td>07725554433</td><td>الرسالة</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <DailyReportCard
          isAdmin
          towers={[{ id: 1, name: "الشهداء" }, { id: 2, name: "الرسالة" }]}
          towerUsers={[]}
          initial={{
            activationCount: 12, activationIn: 450000,
            invoiceCount: 3, invoiceIn: 120000,
            salesIn: 0, masterIn: 230000, otherIn: 0, expenses: 0,
            total: 570000,
          }}
        />
      </div>
    </div>
  );
}
