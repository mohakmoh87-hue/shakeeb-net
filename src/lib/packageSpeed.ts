const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function toAscii(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function packageSpeedMbps(name: string | null | undefined): number | null {
  if (!name) return null;
  const s = toAscii(String(name)).toLowerCase();
  const take = (v: string): number | null => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
  };
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:ميغا|ميجا|ميكا|mega|mbps|mbit|mb|m)(?![a-z])/);
  if (m) { const v = take(m[1]); if (v != null) return v; }
  m = s.match(/(?:سرعة|speed)\s*[:=]?\s*(\d+(?:\.\d+)?)/);
  if (m) { const v = take(m[1]); if (v != null) return v; }
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (nums && nums.length === 1) { const v = take(nums[0]); if (v != null) return v; }
  return null;
}
