import { prisma } from "@/lib/prisma";

export async function usernameTaken(username: string, except?: { userId?: number; techId?: number }): Promise<boolean> {
  const u = await prisma.user.findFirst({
    where: { username, ...(except?.userId ? { NOT: { id: except.userId } } : {}) },
    select: { id: true },
  });
  if (u) return true;
  const t = await prisma.technician.findFirst({
    where: { username: username.trim(), ...(except?.techId ? { NOT: { id: except.techId } } : {}) },
    select: { id: true },
  });
  return !!t;
}
