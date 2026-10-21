"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { AttachmentPicker, PendingAttachment } from "../../components/AttachmentPicker";
import { ReleaseAttachmentActions } from "../../components/ReleaseAttachmentAction";
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

  // "Setiap input ada lampiran" - a message posted into the meeting can carry
  // a document or a whole folder, same attach-then-send pattern as everywhere else.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function attachFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.allSettled(files.map((f) => api.uploadFile(f)));
      const uploaded = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof api.uploadFile>>> => r.status === "fulfilled")
        .map((r) => ({ id: r.value.id, filename: r.value.filename }));
      setAttachments((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  // "Dirangkum dulu dari hasil rapat, lalu dijadikan task" - a draft the
  // Director reviews/edits before anything is actually created; nothing
  // here touches the Task Board until "Buat Task" is pressed.
  const [summarizing, setSummarizing] = useState(false);
  const [taskDraft, setTaskDraft] = useState<{ title: string; description: string; agentId: string } | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskCreated, setTaskCreated] = useState<string | null>(null);

  const isActive = room.status === "ACTIVE";

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    const attachmentIds = attachments.map((a) => a.id);
    setAttachments([]);
    try {
      const result = await api.sendMeetingMessage(room.id, content, attachmentIds);
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

  async function summarize() {
    setSummarizing(true);
    setTaskCreated(null);
    try {
      const draftResult = await api.summarizeMeeting(room.id);
      setTaskDraft({ ...draftResult, agentId: room.participants[0]?.agent.id ?? "" });
    } finally {
      setSummarizing(false);
    }
  }

  async function createTask() {
    if (!taskDraft || !taskDraft.title.trim() || !taskDraft.agentId) return;
    setCreatingTask(true);
    try {
      const result = await api.createTaskFromMeeting(room.id, taskDraft.agentId, taskDraft.title.trim(), taskDraft.description.trim());
      setTaskCreated(result.taskId);
      setTaskDraft(null);
      const updated = await api.getMeeting(room.id);
      setRoom(updated);
    } finally {
      setCreatingTask(false);
    }
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
            <ReleaseAttachmentActions content={m.content} />
          </div>
        ))}
        {failures.map((f) => (
          <div key={f.agentId} className={styles.failure}>
            {f.agentName} sedang tidak bisa merespons (model sibuk/limit) - coba kirim ulang sebentar lagi.
          </div>
        ))}
      </div>

      {room.messages.length > 0 && (
        <div className={styles.createCard}>
          {!taskDraft ? (
            <>
              <button className={styles.linkButton} disabled={summarizing} onClick={summarize} style={{ textAlign: "left" }}>
                {summarizing ? "Merangkum…" : "📋 Rangkum rapat ini & jadikan Task"}
              </button>
              {taskCreated && <p className={styles.participants}>✅ Task dibuat (#{taskCreated.slice(-6)}) - bisa dipantau di Task Board.</p>}
            </>
          ) : (
            <>
              <p className={styles.participants}>Draft task dari hasil rapat - tinjau/edit dulu sebelum dibuat:</p>
              <input
                className={styles.textInput}
                value={taskDraft.title}
                onChange={(e) => setTaskDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                placeholder="Judul task"
              />
              <textarea
                className={styles.composerBox}
                style={{ minHeight: 90 }}
                value={taskDraft.description}
                onChange={(e) => setTaskDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                placeholder="Deskripsi task"
              />
              <label className={styles.participants}>
                Tugaskan ke:{" "}
                <select
                  value={taskDraft.agentId}
                  onChange={(e) => setTaskDraft((d) => (d ? { ...d, agentId: e.target.value } : d))}
                  style={{ background: "#0b1420", color: "#e8edf2", border: "1px solid #1c2b3a", borderRadius: 6, padding: "4px 8px" }}
                >
                  {room.participants.map((p) => (
                    <option key={p.agent.id} value={p.agent.id}>
                      {p.agent.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <button className={styles.primaryButton} disabled={creatingTask || !taskDraft.title.trim()} onClick={createTask}>
                  {creatingTask ? "Membuat…" : "Buat Task"}
                </button>
                <button className={styles.linkButton} onClick={() => setTaskDraft(null)}>
                  Batal
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isActive ? (
        <div className={styles.composer} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <AttachmentPicker
            items={attachments}
            uploading={uploading}
            onAddFiles={attachFiles}
            onRemove={removeAttachment}
            idPrefix={`meeting-${room.id}`}
          />
          <div style={{ display: "flex", gap: 8 }}>
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
        </div>
      ) : (
        <p className={styles.empty}>Rapat ini sudah ditutup.</p>
      )}
    </div>
  );
}
