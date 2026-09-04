"use client";

import { useEffect, useState } from "react";
import { can as rbacCan, type Permission } from "@/lib/rbac";

type Me = {
  isAdmin: boolean; permissions: string[];
  // مديرٌ بصلاحيّاتٍ محدَّدة (طلبُ محمد): المنعُ يصل الواجهةَ أيضاً — وإلّا ظهر زرٌّ
  // يُفشِله الخادمُ، والمستخدمُ لا يعرف أنّ السببَ صلاحيّةٌ لا عطل.
  deniedPermissions?: string[];
  officeCap?: number | null; officeCount?: number; agentName?: string | null;
  subDealerCheck?: boolean; // 🕵️ فحصُ سب-ديلر مفعّلٌ لهذا الوكيل (عَلَمُ المالك)
};

// كاش على مستوى الوحدة: يُجلب /api/me مرة واحدة ويُعاد استخدامه عبر كل الصفحات (يقلّل الطلبات عند التنقّل)
let cache: Me | null = null;
let inflight: Promise<Me | null> | null = null;

function fetchMe(): Promise<Me | null> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Me | null) => { cache = d; inflight = null; return d; })
    .catch(() => { inflight = null; return null; });
  return inflight;
}

// خطّاف لقراءة صلاحيات المستخدم الحالي (لإظهار الأزرار حسب الصلاحية)
export function usePermission() {
  const [me, setMe] = useState<Me | null>(cache);

  useEffect(() => {
    if (cache) { setMe(cache); return; }
    let active = true;
    fetchMe().then((d) => { if (active) setMe(d); });
    return () => { active = false; };
  }, []);

  // نفس منطق الخادم (يشمل توافق المفاتيح القديمة حتى إعادة الدخول بعد الهجرة)
  const can = (perm: string) =>
    !!me && rbacCan(
      { isAdmin: me.isAdmin, permissions: me.permissions as Permission[], deniedPermissions: me.deniedPermissions },
      perm as Permission,
    );
  return { me, can };
}
