"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import ExpandableText from "../components/ExpandableText";
import styles from "./questions.module.css";

type Question = {
  id: string;
  question: string;
  askedAt: string;
  agent: { displayName: string; agentRole: { name: string } };
  division: { name: string; slug: string };
  task: { id: string; title: string; projectId?: string | null; project?: { name: string } | null } | null;
};

// This GitHub account is dedicated to this platform's project output (see
// the director's own setup) - every repo-creation link points there.
const GITHUB_OWNER = "ZulhardiyantoVraxen";

const REPO_REQUEST_PREFIX = "[REPO_REQUEST:";

function parseRepoRequest(question: string): { repoName: string; reason: string } | null {
  if (!question.startsWith(REPO_REQUEST_PREFIX)) return null;
  const closing = question.indexOf("]");
  if (closing === -1) return null;
  return {
    repoName: question.slice(REPO_REQUEST_PREFIX.length, closing).trim(),
    reason: question.slice(closing + 1).trim(),
  };
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
 * "PM harus lebih interaktif bertanya kepada direktur" needs somewhere for
 * those questions to actually land - this is that inbox, parallel to
 * /approvals: one card per open question, answer it inline and the
 * underlying task (if any) resumes with that director agent immediately.
 *
 * A repo-request ("nanti PM minta saya tulis nama repositorynya") is a
 * special case of the same pause-the-task mechanism - instead of a free-text
 * answer box, it gets a dedicated card: a pre-filled GitHub repo-creation
 * link, an editable name (in case the director creates it under a different
 * name than the PM proposed), and one confirm button.
 */
export default function QuestionsPanel({ initial }: { initial: Question[] }) {
  const [questions, setQuestions] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [repoNameDrafts, setRepoNameDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Setiap pertanyaan juga ada attachment filenya" - same attach-then-send
  // pattern as the chat/perintah surfaces: picking a file uploads it right
  // away, and the id sits here until the answer is actually sent.
  const [attachments, setAttachments] = useState<Record<string, { id: string; filename: string }>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function attach(id: string, file: File) {
    setUploadingId(id);
    try {
      const res = await api.uploadFile(file);
      setAttachments((prev) => ({ ...prev, [id]: { id: res.id, filename: res.filename } }));
    } catch {
      // leave no attachment rather than blocking the answer box
    } finally {
      setUploadingId(null);
    }
  }

  async function answer(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setBusyId(id);
    try {
      await api.answerQuestion(id, text, attachments[id]?.id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      setAttachments((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      // leave the card + draft in place so the director can just retry
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRepo(id: string, proposedName: string) {
    const repoName = (repoNameDrafts[id] ?? proposedName).trim();
    if (!repoName) return;
    setBusyId(id);
    try {
      await api.confirmRepo(id, repoName);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch {
      // leave the card in place so the director can just retry
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Pertanyaan untuk Anda</h1>
        <span className={styles.headerCount}>{questions.length}</span>
      </div>
      <p className={styles.lead}>
        PM (atau Chief of Staff) berhenti sejenak untuk menanyakan ini sebelum melanjutkan pekerjaannya. Begitu Anda
        jawab (atau konfirmasi repo sudah dibuat), task yang menunggu langsung dilanjutkan.
      </p>

      {questions.length === 0 && <p className={styles.empty}>Tidak ada pertanyaan yang menunggu.</p>}

      {questions.map((q) => {
        const repoRequest = parseRepoRequest(q.question);
        return (
          <div key={q.id} className={styles.card}>
            <div className={styles.cardMeta}>
              <span className={styles.fromBadge}>{q.agent.agentRole.name}</span>
              <span className={styles.metaText}>
                {q.agent.displayName} · {q.division.name} · {formatTime(q.askedAt)}
              </span>
              {q.task && <span className={styles.taskLink}>Task: {q.task.title}</span>}
            </div>

            {repoRequest ? (
              <>
                <p className={styles.question}>
                  📦 PM meminta Anda membuat repository GitHub baru untuk project
                  {q.task?.project?.name ? ` "${q.task.project.name}"` : ""}, sebelum mulai development.
                </p>
                {repoRequest.reason && <ExpandableText text={repoRequest.reason} className={styles.repoReason} />}
                <div className={styles.repoRow}>
                  <input
                    className={styles.repoNameInput}
                    value={repoNameDrafts[q.id] ?? repoRequest.repoName}
                    onChange={(e) => setRepoNameDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  />
                  <a
                    href={`https://github.com/new?owner=${GITHUB_OWNER}&name=${encodeURIComponent(
                      repoNameDrafts[q.id] ?? repoRequest.repoName,
                    )}&visibility=private`}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.repoCreateLink}
                  >
                    🔗 Buka GitHub (buat repo baru)
                  </a>
                </div>
                <div className={styles.answerRow}>
                  <button
                    className={styles.answerButton}
                    disabled={busyId === q.id || !(repoNameDrafts[q.id] ?? repoRequest.repoName).trim()}
                    onClick={() => confirmRepo(q.id, repoRequest.repoName)}
                  >
                    {busyId === q.id ? "Mengonfirmasi..." : "✅ Konfirmasi: Repo sudah dibuat"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <ExpandableText text={q.question} className={styles.question} />
                <textarea
                  className={styles.answerBox}
                  placeholder="Ketik jawaban Anda... (tempel link juga bisa, akan dibaca otomatis oleh agent)"
                  value={drafts[q.id] ?? ""}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
                <div className={styles.answerRow}>
                  <label className={styles.answerButton} style={{ cursor: "pointer", background: "transparent" }}>
                    {uploadingId === q.id ? "Mengunggah…" : "📎 Lampirkan file"}
                    <input
                      type="file"
                      style={{ display: "none" }}
                      disabled={uploadingId === q.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) attach(q.id, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {attachments[q.id] && (
                    <span className={styles.metaText}>
                      {attachments[q.id].filename}{" "}
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => { const next = { ...prev }; delete next[q.id]; return next; })}
                        style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                  <button
                    className={styles.answerButton}
                    disabled={busyId === q.id || !(drafts[q.id] ?? "").trim()}
                    onClick={() => answer(q.id)}
                  >
                    {busyId === q.id ? "Mengirim..." : "Kirim jawaban"}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
