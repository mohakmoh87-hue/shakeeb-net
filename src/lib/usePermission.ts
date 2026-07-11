"use client";

import { useEffect, useState } from "react";

type Me = { isAdmin: boolean; permissions: string[] };

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

  const can = (perm: string) => !!me && (me.isAdmin || me.permissions.includes(perm));
  return { me, can };
}
