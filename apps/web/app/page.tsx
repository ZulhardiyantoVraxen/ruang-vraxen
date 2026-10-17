import { api } from "@/lib/api";
import OfficeDashboard from "./OfficeDashboard";

// Office overview: dynamic - renders whatever divisions exist right now, no
// hardcoded Software/Konten/Konstruksi/Kesehatan list. New divisions created
// through onboarding show up automatically as extra rooms below the default
// five (see computeLayout in OfficeDashboard.tsx).
export default async function OfficePage() {
  const [divisions, approvals] = await Promise.all([
    api.listDivisions().catch(() => []),
    api.pendingApprovals().catch(() => []),
  ]);

  return <OfficeDashboard divisions={divisions} approvals={approvals} />;
}
