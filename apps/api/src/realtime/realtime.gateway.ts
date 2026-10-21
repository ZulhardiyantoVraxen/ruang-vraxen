import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

/**
 * "Pakai socket aja biar realtime" - one small generic gateway, not
 * meetings-specific, so any future chat-like surface can reuse it. Clients
 * `join` a logical room name (e.g. `meeting:<roomId>`) and the owning
 * service calls `emit()` right after it persists something worth pushing -
 * no polling, no Kafka round-trip, just a direct in-process push since the
 * gateway lives in the same Nest app/process as the services that call it.
 *
 * Attaches to the SAME HTTP server/port Nest already listens on (no
 * `{ port }` given) - Caddy routes the socket.io path straight to this
 * container (see Caddyfile's /socket.io/* block) bypassing the `web`
 * container, since Next's own rewrite proxy isn't guaranteed to pass
 * WebSocket upgrades through cleanly.
 */
@WebSocketGateway({ cors: { origin: "*" } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection() {
    // no-op - rooms are joined explicitly via the "join" message below
  }

  handleDisconnect() {
    // socket.io cleans up room membership on disconnect automatically
  }

  @SubscribeMessage("join")
  handleJoin(client: Socket, room: string) {
    if (typeof room === "string" && room) client.join(room);
  }

  @SubscribeMessage("leave")
  handleLeave(client: Socket, room: string) {
    if (typeof room === "string" && room) client.leave(room);
  }

  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
}
