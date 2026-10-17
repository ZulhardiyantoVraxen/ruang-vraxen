import { api } from "@/lib/api";
import ChiefOfStaffPanel from "./ChiefOfStaffPanel";

// A separate, dedicated inbox for "Pusat" / Chief of Staff - this is the one
// place where work goes IN to the organization from the top, instead of
// being filed directly against a specific division. Per the "Alur Kerja
// Startup Virtual" flow, Chief of Staff is who you (the PIC) hand a
// directive to; CoS is then the one who breaks it down / routes it onward.
export default async function ChiefOfStaffPage() {
  const pusat = await api.getDivision("pusat").catch(() => null);
  return <ChiefOfStaffPanel pusat={pusat} />;
}
