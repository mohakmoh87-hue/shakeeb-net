import type { SasUser } from "./sas4";

// كاش لآخر قائمة مشتركين عرضتها لوحة SAS4 (مفتاح: معرّف مستخدم البرنامج)
type Entry = { users: SasUser[]; at: number; towerId: number };
const cache = new Map<number, Entry>();

export function setLastView(userId: number, towerId: number, users: SasUser[]) {
  cache.set(userId, { users, at: Date.now(), towerId });
}
export function getLastView(userId: number): Entry | undefined {
  return cache.get(userId);
}
