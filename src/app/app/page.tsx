import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { BackendError, backendJson, SESSION_COOKIE } from "@/lib/server/backend";
import type { Network, Plan } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Me { email: string; fullName: string; tenantName: string }

export default async function Workspace() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  let data: [Network, Plan, Me] | null = null;
  try {
    data = await Promise.all([
      backendJson<Network>("/v1/network", token),
      backendJson<Plan>("/v1/plan", token),
      backendJson<Me>("/v1/me", token),
    ]);
  } catch (error) {
    if (!(error instanceof BackendError && error.status === 401)) throw error;
  }
  if (!data) redirect("/login?expired=1");
  const [network, plan, me] = data;
  return <Dashboard network={network} initialPlan={plan} user={{ name: me.fullName || me.email, tenant: me.tenantName }} />;
}
