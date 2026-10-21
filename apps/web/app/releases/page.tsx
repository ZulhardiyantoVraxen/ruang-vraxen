import { api } from "@/lib/api";
import ReleasesPanel from "./ReleasesPanel";

export default async function ReleasesPage() {
  const releases = await api.listReleases().catch(() => []);
  return <ReleasesPanel initialReleases={releases} />;
}
