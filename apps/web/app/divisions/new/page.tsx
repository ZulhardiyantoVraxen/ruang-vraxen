"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import styles from "./newDivision.module.css";

type Reply =
  | { type: "question"; question: string }
  | { type: "recommendation"; summary: string; roster: any[] };

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * "Saya hanya perlu bilang 'Divisi Logistik'" - this is a one-shot brief,
 * not an interview: type a name, Auditor writes up the division's own
 * needs and scope and proposes a roster (always with exactly one PM), all
 * in a single AI call. A clarifying question only shows up on the rare
 * brief that's genuinely ambiguous - see ORCHESTRATOR_SYSTEM_PROMPT.
 */
export default function NewDivisionPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [brief, setBrief] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    if (!brief.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.startOnboarding(brief.trim());
      setSessionId(res.session.id);
      setReply(res.reply);
      setName(brief.trim());
      setSlug(slugify(brief.trim()));
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai sesi Auditor.");
    } finally {
      setBusy(false);
    }
  }

  async function sendAnswer() {
    if (!sessionId || !input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.answerOnboarding(sessionId, input.trim());
      setReply(next);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim jawaban.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!sessionId || !slug || !name) return;
    setBusy(true);
    setError(null);
    try {
      const division = await api.confirmOnboarding(sessionId, slug, name);
      window.location.href = `/divisions/${division.slug}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat divisi.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1>Divisi Baru</h1>
      <p className={styles.lead}>
        Cukup sebutkan nama atau garis besar divisinya - Auditor yang akan menuliskan kebutuhan, cakupan kerja, dan
        susunan timnya (selalu dengan tepat satu PM sebagai titik keputusan).
      </p>

      {!sessionId && (
        <div className={styles.card}>
          <p className={styles.fieldLabel}>Nama / garis besar divisi</p>
          <input
            className={styles.field}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Contoh: Divisi Logistik"
            onKeyDown={(e) => e.key === "Enter" && begin()}
          />
          <p className={styles.optionalNote}>
            Boleh ditambah sedikit konteks kalau mau (mis. "Divisi Logistik - urus pengiriman & stok gudang"), tapi
            nama saja sudah cukup.
          </p>
          {error && <p style={{ color: "#e0806b", fontSize: 12.5, marginTop: 10 }}>{error}</p>}
          <button className={styles.submitButton} disabled={busy || !brief.trim()} onClick={begin}>
            {busy ? "Auditor sedang menyusun..." : "Minta Auditor susun kebutuhannya"}
          </button>
        </div>
      )}

      {reply?.type === "question" && (
        <div className={styles.card}>
          <p className={styles.auditorTag}>Auditor bertanya</p>
          <p className={styles.question}>{reply.question}</p>
          <input
            className={styles.field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendAnswer()}
            placeholder="Jawaban Anda..."
          />
          {error && <p style={{ color: "#e0806b", fontSize: 12.5, marginTop: 10 }}>{error}</p>}
          <button className={styles.submitButton} disabled={busy || !input.trim()} onClick={sendAnswer}>
            {busy ? "Mengirim..." : "Jawab"}
          </button>
        </div>
      )}

      {reply?.type === "recommendation" && (
        <div className={styles.card}>
          <p className={styles.auditorTag}>Ditulis oleh Auditor</p>
          <p className={styles.writeup}>{reply.summary}</p>

          <table className={styles.table}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Tier</th>
                <th>Tanggung jawab</th>
              </tr>
            </thead>
            <tbody>
              {reply.roster.map((r, i) => (
                <tr key={i}>
                  <td className={styles.roleName}>
                    {r.roleName}
                    {r.requiresApproval && <span className={styles.pmBadge}>PM</span>}
                  </td>
                  <td className={styles.tier}>{r.tier}</td>
                  <td>{r.responsibilities}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.confirmRow}>
            <input className={styles.field} placeholder="Nama divisi" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              className={styles.field}
              placeholder="slug"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
            />
          </div>
          {error && <p style={{ color: "#e0806b", fontSize: 12.5, marginTop: 10 }}>{error}</p>}
          <button className={styles.submitButton} disabled={busy || !slug || !name} onClick={confirm}>
            {busy ? "Membuat divisi..." : "Konfirmasi & Buat Divisi"}
          </button>
        </div>
      )}
    </div>
  );
}
