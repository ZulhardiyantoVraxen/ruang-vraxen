"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import styles from "../meetings.module.css";

type Agent = { id: string; displayName: string; status: string };
type Message = {
  id: string;
  senderType: "DIRECTOR" | "AGENT";
  senderAgent: Agent | null;
  content: string;
  createdAt: string;
};
type Room = {
  id: string;
  type: "DIRECTOR_CEO" | "OPEN";
  title: string;
  status: "ACTIVE" | "CLOSED";
  participants: { agent: Agent }[];
  messages: Message[];
};

function formatTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/**
 * One message from the Director triggers EVERY participant to reply in
 * turn - so a single send can take a while (one model call per participant,
 * sequentially, each with the self-healing OpenRouter fallback chain) before
 * all the new bubbles land at once. A participant whose whole fallback chain
 * failed shows as a quiet note instead of silently vanishing.
 */
export default function MeetingRoomPanel({ initialRoom }: { initialRoom: Room }) {
  const [room, setRoom] = useState(initialRoom);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failures, setFailures] = useState<{ agentId: string; agentName: string; reason: string }[]>([]);

  const isActive = room.status === "ACTIVE";

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    try {
      const result = await api.sendMeetingMessage(room.id, content);
      setRoom((prev) => ({ ...prev, messages: [...prev.messages, ...result.messages] }));
      setFailures(result.failures);
    } catch {
      setDraft(content); // let the Director just retry
    } finally {
      setSending(false);
    }
  }

  async function closeRoom() {
    const updated = await api.closeMeeting(room.id);
    setRoom(updated);
  }

  return (
    <div className={styles.page}>
      <a href="/meetings" className={styles.backLink}>
        ← Semua rapat
      </a>

      <div className={styles.roomHeader}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{room.title}</h1>
        {room.type === "OPEN" && isActive && (
          <button className={styles.linkButton} onClick={closeRoom}>
            Tutup rapat
          </button>
        )}
        {!isActive && <span className={`${styles.badge} ${styles.badgeClosed}`}>Ditutup</span>}
      </div>
      <p className={styles.participants}>Peserta: {room.participants.map((p) => p.agent.displayName).join(", ")}</p>

      <div className={styles.transcript}>
        {room.messages.length === 0 && <p className={styles.empty}>Belum ada pesan. Mulai rapat dengan mengetik di bawah.</p>}
        {room.messages.map((m) => (
          <div key={m.id} className={`${styles.bubble} ${m.senderType === "DIRECTOR" ? styles.bubbleDirector : styles.bubbleAgent}`}>
            {m.senderType === "AGENT" && <span className={styles.bubbleMeta}>{m.senderAgent?.displayName}</span>}
            {m.content}
          </div>
        ))}
        {failures.map((f) => (
          <div key={f.agentId} className={styles.failure}>
            {f.agentName} sedang tidak bisa merespons (model sibuk/limit) - coba kirim ulang sebentar lagi.
          </div>
        ))}
      </div>

      {isActive ? (
        <div className={styles.composer}>
          <textarea
            className={styles.composerBox}
            placeholder="Ketik sebagai Direktur... (semua peserta akan menanggapi)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className={styles.primaryButton} disabled={sending || !draft.trim()} onClick={send}>
            {sending ? "Mengirim…" : "Kirim"}
          </button>
        </div>
      ) : (
        <p className={styles.empty}>Rapat ini sudah ditutup.</p>
      )}
    </div>
  );
}
