import { getCardSession } from "@/lib/cardAuth";
import CardLogin from "./CardLogin";
import CardsDashboard from "./CardsDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { robots: { index: false, follow: false } };

export default async function CardsPage() {
  const s = await getCardSession();
  return s ? <CardsDashboard /> : <CardLogin />;
}
