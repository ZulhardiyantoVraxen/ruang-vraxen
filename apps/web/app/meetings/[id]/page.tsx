import { api } from "@/lib/api";
import MeetingRoomPanel from "./MeetingRoomPanel";

export default async function MeetingRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await api.getMeeting(id);
  return <MeetingRoomPanel initialRoom={room} />;
}
