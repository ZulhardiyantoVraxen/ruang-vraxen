import { api } from "@/lib/api";
import ArchivePanel from "./ArchivePanel";

export default async function ArchivePage() {
  const entries = await api.archive().catch(() => []);
  return <ArchivePanel initial={entries} />;
}
