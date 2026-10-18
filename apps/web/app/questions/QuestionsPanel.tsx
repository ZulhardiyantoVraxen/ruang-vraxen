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
  task: { id: string; title: string } | null;
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
 * "PM harus lebih interaktif bertanya kepada direktur" needs somewhere for
 * those questions to actually land - this is that inbox, parallel to
 * /approvals: one card per open question, answer it inline and the
 * underlying task (if any) resumes with that director agent immediately.
 */
export default function QuestionsPanel({ initial }: { initial: Question[] }) {
  const [questions, setQuestions] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function answer(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setBusyId(id);
    try {
      await api.answerQuestion(id, text);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch {
      // leave the card + draft in place so the director can just retry
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
        jawab, task yang menunggu langsung dilanjutkan dengan jawaban Anda.
      </p>

      {questions.length === 0 && <p className={styles.empty}>Tidak ada pertanyaan yang menunggu.</p>}

      {questions.map((q) => (
        <div key={q.id} className={styles.card}>
          <div className={styles.cardMeta}>
            <span className={styles.fromBadge}>{q.agent.agentRole.name}</span>
            <span className={styles.metaText}>
              {q.agent.displayName} · {q.division.name} · {formatTime(q.askedAt)}
            </span>
            {q.task && <span className={styles.taskLink}>Task: {q.task.title}</span>}
          </div>
          <ExpandableText text={q.question} className={styles.question} />
          <textarea
            className={styles.answerBox}
            placeholder="Ketik jawaban Anda..."
            value={drafts[q.id] ?? ""}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
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
        </div>
      ))}
    </div>
  );
}
