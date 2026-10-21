"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import ExpandableText from "../components/ExpandableText";
import { AttachmentPicker, PendingAttachment } from "../components/AttachmentPicker";
import styles from "./questions.module.css";

type Question = {
  id: string;
  question: string;
  askedAt: string;
  answeredAt?: string | null;
  answer?: string | null;
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

  // "Dikelompokkan berdasarkan topik" (= divisi) - "all" | "archive" | a
  // division slug. A division's own toggle only exists while it still has
  // at least one open question, so this is recomputed from `questions`
  // every render rather than captured once from `initial`.
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [archived, setArchived] = useState<Question[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const topics = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; count: number }>();
    for (const q of questions) {
      const existing = map.get(q.division.slug);
      if (existing) existing.count += 1;
      else map.set(q.division.slug, { slug: q.division.slug, name: q.division.name, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [questions]);

  // "Sampai pertanyaan itu habis, toggle nomor akan hilang" - once the topic
  // the director was looking at runs dry, fall back to "Semua" instead of
  // showing an empty tab that no longer has a toggle to click back from.
  if (activeTopic !== "all" && activeTopic !== "archive" && !topics.some((t) => t.slug === activeTopic)) {
    setActiveTopic("all");
  }

  async function openArchive() {
    setActiveTopic("archive");
    if (archived !== null) return;
    setArchiveLoading(true);
    try {
      setArchived(await api.archivedQuestions());
    } catch {
      setArchived([]);
    } finally {
      setArchiveLoading(false);
    }
  }

  const visible =
    activeTopic === "archive" ? archived ?? [] : activeTopic === "all" ? questions : questions.filter((q) => q.division.slug === activeTopic);

  // "Setiap pertanyaan juga ada attachment filenya, bisa dokumen atau
  // folder" - same attach-then-send pattern as every other input surface:
  // picking file(s) or a whole folder uploads them right away, and the ids
  // sit here until the answer is actually sent.
  const [attachments, setAttachments] = useState<Record<string, PendingAttachment[]>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function attachFiles(id: string, files: File[]) {
    if (files.length === 0) return;
    setUploadingId(id);
    try {
      const results = await Promise.allSettled(files.map((f) => api.uploadFile(f)));
      const uploaded = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof api.uploadFile>>> => r.status === "fulfilled")
        .map((r) => ({ id: r.value.id, filename: r.value.filename }));
      setAttachments((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...uploaded] }));
    } finally {
      setUploadingId(null);
    }
  }

  function removeAttachment(id: string, attachmentId: string) {
    setAttachments((prev) => ({ ...prev, [id]: (prev[id] ?? []).filter((a) => a.id !== attachmentId) }));
  }

  async function answer(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setBusyId(id);
    try {
      await api.answerQuestion(id, text, (attachments[id] ?? []).map((a) => a.id));
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
        jawab (atau konfirmasi repo sudah dibuat), task yang menunggu langsung dilanjutkan dan pertanyaannya pindah ke Arsip.
      </p>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${activeTopic === "all" ? styles.tabActive : ""}`}
          onClick={() => setActiveTopic("all")}
        >
          Semua <span className={styles.tabCount}>{questions.length}</span>
        </button>
        {topics.map((t) => (
          <button
            key={t.slug}
            type="button"
            className={`${styles.tab} ${activeTopic === t.slug ? styles.tabActive : ""}`}
            onClick={() => setActiveTopic(t.slug)}
          >
            {t.name} <span className={styles.tabCount}>{t.count}</span>
          </button>
        ))}
        <button
          type="button"
          className={`${styles.tab} ${styles.tabArchive} ${activeTopic === "archive" ? styles.tabActive : ""}`}
          onClick={openArchive}
        >
          🗂 Arsip
        </button>
      </div>

      {activeTopic === "archive" && archiveLoading && <p className={styles.empty}>Memuat arsip…</p>}
      {activeTopic === "archive" && !archiveLoading && visible.length === 0 && (
        <p className={styles.empty}>Belum ada pertanyaan di arsip.</p>
      )}
      {activeTopic !== "archive" && visible.length === 0 && (
        <p className={styles.empty}>
          {questions.length === 0 ? "Tidak ada pertanyaan yang menunggu." : "Tidak ada pertanyaan menunggu untuk topik ini."}
        </p>
      )}

      {visible.map((q) => {
        if (activeTopic === "archive") {
          return (
            <div key={q.id} className={styles.card}>
              <div className={styles.cardMeta}>
                <span className={styles.fromBadge}>{q.agent.agentRole.name}</span>
                <span className={styles.metaText}>
                  {q.agent.displayName} · {q.division.name} · {formatTime(q.answeredAt ?? q.askedAt)}
                </span>
                {q.task && <span className={styles.taskLink}>Task: {q.task.title}</span>}
              </div>
              <ExpandableText text={parseRepoRequest(q.question) ? "📦 Permintaan repository" : q.question} className={styles.question} />
              {q.answer && (
                <p className={styles.metaText} style={{ color: "#5fc9b8" }}>
                  ✅ {q.answer}
                </p>
              )}
            </div>
          );
        }
        return renderOpenCard(q);
      })}
    </div>
  );

  function renderOpenCard(q: Question) {
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
                <AttachmentPicker
                  items={attachments[q.id] ?? []}
                  uploading={uploadingId === q.id}
                  onAddFiles={(files) => attachFiles(q.id, files)}
                  onRemove={(attId) => removeAttachment(q.id, attId)}
                  idPrefix={`question-${q.id}`}
                />
                <div className={styles.answerRow}>
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
  }
}
