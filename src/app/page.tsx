import { Dashboard } from "@/components/dashboard";
import { network } from "@/lib/data/network";
import { calculatePlan } from "@/lib/server/planning";

export default function Home() {
  return <Dashboard network={network} initialPlan={calculatePlan()} />;
}
