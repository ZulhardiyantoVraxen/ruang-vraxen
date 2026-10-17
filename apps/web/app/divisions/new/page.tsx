"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Reply =
  | { type: "question"; question: string }
  | { type: "recommendation"; summary: string; roster: any[] };

/**
 * The interactive "bertanya apa yang dibutuhkan" wizard: free-text brief ->
 * orchestrator asks up to 4 questions -> proposes a roster (roles, tiers,
 * model class implied by tier) -> user confirms and the Division is created.
 */
export default function NewDivisionPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");

  async function begin() {
    setBusy(true);
    const res = await api.startOnboarding(input);
    setSessionId(res.session.id);
    setReply(res.reply);
    setInput("");
    setBusy(false);
  }

  async function sendAnswer() {
    if (!sessionId) return;
    setBusy(true);
    const next = await api.answerOnboarding(sessionId, input);
    setReply(next);
    setInput("");
    setBusy(false);
  }

  async function confirm() {
    if (!sessionId) return;
    setBusy(true);
    const division = await api.confirmOnboarding(sessionId, slug, name);
    window.location.href = `/divisions/${division.slug}`;
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Divisi Baru</h1>

      {!sessionId && (
        <>
          <p style={{ color: "#94a3b8" }}>
            Ceritakan singkat divisi apa yang mau dibuat dan apa yang dikerjakan.
          </p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            style={{ width: "100%", padding: 8 }}
            placeholder="Contoh: divisi legal buat review kontrak vendor dan ngurus perizinan..."
          />
          <button disabled={busy || !input} onClick={begin}>Mulai</button>
        </>
      )}

      {reply?.type === "question" && (
        <div style={{ marginTop: 24 }}>
          <p><strong>Orkestrator:</strong> {reply.question}</p>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} style={{ width: "100%", padding: 8 }} />
          <button disabled={busy || !input} onClick={sendAnswer}>Jawab</button>
        </div>
      )}

      {reply?.type === "recommendation" && (
        <div style={{ marginTop: 24 }}>
          <p>{reply.summary}</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr><th align="left">Role</th><th align="left">Tier</th><th align="left">Tanggung jawab</th><th>Approval</th></tr>
            </thead>
            <tbody>
              {reply.roster.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid #334155" }}>
                  <td>{r.roleName}</td>
                  <td>{r.tier}</td>
                  <td style={{ fontSize: 13, color: "#94a3b8" }}>{r.responsibilities}</td>
                  <td align="center">{r.requiresApproval ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <input placeholder="slug (mis. legal)" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <input placeholder="Nama divisi" value={name} onChange={(e) => setName(e.target.value)} />
            <button disabled={busy || !slug || !name} onClick={confirm}>Konfirmasi &amp; Buat Divisi</button>
          </div>
        </div>
      )}
    </div>
  );
}
