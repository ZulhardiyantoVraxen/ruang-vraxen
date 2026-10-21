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
  lastSummaryTitle?: string | null;
  lastSummaryText?: string | null;
  lastSummaryAt?: string | null;
  lastSummaryDriveUrl?: string | null;
};

function formatBadge(room: MeetingRoom) {
  if (room.status === "CLOSED") return { label: "Ditutup", cls: styles.badgeClosed };
  if (room.type === "DIRECTOR_CEO") return { label: "Privat · Aktif", cls: styles.badgeDirectorCeo };
  return { label: "Terbuka · Aktif", cls: styles.badgeOpen };
}

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
 * Point 4: "satu privat Direktur+Staff Direksi, satu terbuka untuk semua tim yang
 * diundang." The private room is a one-click standing fixture (idempotent -
 * opening it twice never creates a duplicate); open rooms are created ad hoc
 * per topic with whichever agents the Director picks from the full roster.
 *
 * "Setiap card ada ringkasan rapat dan status rapat" - both room types share
 * the same card: a status badge, the full participant list, and (once
 * "Rangkum rapat" has been used at least once) the latest summary snippet
 * plus a link to the Google Doc it was saved to, if Drive is configured.
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

  function renderRoomCard(room: MeetingRoom) {
    const badge = formatBadge(room);
    return (
      <a key={room.id} href={`/meetings/${room.id}`} className={styles.card}>
        <p className={styles.cardTitle}>{room.title}</p>
        <div className={styles.cardMeta}>
          <span className={`${styles.badge} ${badge.cls}`}>{badge.label}</span>
          <span>{room.participants.map((p) => p.agent.displayName).join(", ")}</span>
        </div>
        {room.lastSummaryText ? (
          <div className={styles.cardSummary}>
            <p className={styles.cardSummaryLabel}>
              📋 Ringkasan terakhir{room.lastSummaryAt ? ` · ${formatTime(room.lastSummaryAt)}` : ""}
            </p>
            <p className={styles.cardSummaryText}>{room.lastSummaryText}</p>
            {room.lastSummaryDriveUrl && (
              <a
                href={room.lastSummaryDriveUrl}
                target="_blank"
                rel="noreferrer"
                className={styles.cardSummaryDriveLink}
                onClick={(e) => e.stopPropagation()}
              >
                📄 Lihat di Google Drive
              </a>
            )}
          </div>
        ) : (
          <p className={styles.cardSummaryEmpty}>Belum ada ringkasan - buka rapat ini dan pakai "Rangkum rapat & jadikan Task".</p>
        )}
      </a>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Ruang Rapat</h1>
      </div>
      <p className={styles.lead}>
        Rapat privat selalu antara Anda dan seluruh Staff Direksi (CEO, CFO, CTO, COO). Rapat terbuka dibuat per topik - undang tim mana saja yang perlu hadir;
        setiap kali Anda mengirim pesan, semua peserta yang diundang ikut menanggapi secara bergiliran.
      </p>

      {directorCeoRoom ? (
        renderRoomCard(directorCeoRoom)
      ) : (
        <button className={styles.primaryButton} disabled={busy} onClick={openPrivateRoom} style={{ alignSelf: "flex-start" }}>
          {busy ? "Membuka…" : "🏛 Buka rapat privat dengan Staff Direksi"}
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

      {openRooms.map(renderRoomCard)}
    </div>
  );
}
