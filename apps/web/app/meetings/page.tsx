import { api } from "@/lib/api";
import MeetingsPanel from "./MeetingsPanel";

export default async function MeetingsPage() {
  const [rooms, divisions] = await Promise.all([
    api.listMeetings("ACTIVE").catch(() => []),
    api.listDivisions().catch(() => []),
  ]);
  return <MeetingsPanel initialRooms={rooms} divisions={divisions} />;
}
