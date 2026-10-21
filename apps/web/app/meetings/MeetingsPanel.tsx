"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import styles from "./meetings.module.css";

type Agent = { id: string; displayName: string; status: string };
type AgentRole = { id: string; name: string; agents: Agent[] };
type Division = { id: string; slug: string; name: string; agentRoles: AgentRole[] };

type MeetingRoom = {
  id: string;
  type: "DIRECTOR_CEO" | "OPEN";
  title: string;
  status: "ACTIVE" | "CLOSED";
  participants: { agent: Agent }[];
};

function formatBadge(room: MeetingRoom) {
  if (room.status === "CLOSED") return { label: "Ditutup", cls: styles.badgeClosed };
  if (room.type === "DIRECTOR_CEO") return { label: "Privat · Direktur & CEO", cls: styles.badgeDirectorCeo };
  return { label: "Terbuka", cls: styles.badgeOpen };
}

/**
 * Point 4: "satu privat Direktur+CEO, satu terbuka untuk semua tim yang
 * diundang." The private room is a one-click standing fixture (idempotent -
 * opening it twice never creates a duplicate); open rooms are created ad hoc
 * per topic with whichever agents the Director picks from the full roster.
 */
export default function MeetingsPanel({ initialRooms, divisions }: { initialRooms: MeetingRoom[]; divisions: Division[] }) {
  const [rooms, setRooms] = useState(initialRooms);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const allAgents = useMemo(
    () =>
      divisions.flatMap((d) =>
        d.agentRoles.flatMap((r) => r.agents.map((a) => ({ ...a, roleName: r.name, divisionName: d.name }))),
      ),
    [divisions],
  );

  const directorCeoRoom = rooms.find((r) => r.type === "DIRECTOR_CEO");
  const openRooms = rooms.filter((r) => r.type === "OPEN");

  async function openPrivateRoom() {
    setBusy(true);
    try {
      const room = await api.openDirectorCeoRoom();
      window.location.href = `/meetings/${room.id}`;
    } finally {
      setBusy(false);
    }
  }

  function toggleInvite(agentId: string) {
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  async function createRoom() {
    if (!title.trim() || invited.size === 0) return;
    setBusy(true);
    try {
      const room = await api.createMeeting(title.trim(), Array.from(invited));
      window.location.href = `/meetings/${room.id}`;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Ruang Rapat</h1>
      </div>
      <p className={styles.lead}>
        Rapat privat selalu antara Anda dan CEO. Rapat terbuka dibuat per topik - undang tim mana saja yang perlu hadir;
        setiap kali Anda mengirim pesan, semua peserta yang diundang ikut menanggapi secara bergiliran.
      </p>

      {directorCeoRoom ? (
        <a href={`/meetings/${directorCeoRoom.id}`} className={styles.card}>
          <p className={styles.cardTitle}>{directorCeoRoom.title}</p>
          <div className={styles.cardMeta}>
            <span className={`${styles.badge} ${styles.badgeDirectorCeo}`}>Privat · Direktur &amp; CEO</span>
          </div>
        </a>
      ) : (
        <button className={styles.primaryButton} disabled={busy} onClick={openPrivateRoom} style={{ alignSelf: "flex-start" }}>
          {busy ? "Membuka…" : "🏛 Buka rapat privat dengan CEO"}
        </button>
      )}

      <div className={styles.header}>
        <h1 style={{ fontSize: 16 }}>Rapat terbuka</h1>
        <button className={styles.linkButton} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Batal" : "+ Rapat baru"}
        </button>
      </div>

      {showCreate && (
        <div className={styles.createCard}>
          <input
            className={styles.textInput}
            placeholder="Judul/agenda rapat, misalnya: Rencana Q4 lintas divisi"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className={styles.inviteGrid}>
            {allAgents.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`${styles.inviteChip} ${invited.has(a.id) ? styles.inviteChipActive : ""}`}
                onClick={() => toggleInvite(a.id)}
              >
                {a.displayName} · {a.roleName}
              </button>
            ))}
          </div>
          <button
            className={styles.primaryButton}
            disabled={busy || !title.trim() || invited.size === 0}
            onClick={createRoom}
            style={{ alignSelf: "flex-start" }}
          >
            {busy ? "Membuat…" : `Buat rapat (${invited.size} diundang)`}
          </button>
        </div>
      )}

      {openRooms.length === 0 && !showCreate && <p className={styles.empty}>Belum ada rapat terbuka yang berjalan.</p>}

      {openRooms.map((room) => {
        const badge = formatBadge(room);
        return (
          <a key={room.id} href={`/meetings/${room.id}`} className={styles.card}>
            <p className={styles.cardTitle}>{room.title}</p>
            <div className={styles.cardMeta}>
              <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
              <span>{room.participants.map((p) => p.agent.displayName).join(", ")}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
