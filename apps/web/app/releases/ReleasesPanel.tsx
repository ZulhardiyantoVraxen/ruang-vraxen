"use client";

import { useState } from "react";
import { zipSync } from "fflate";
import { api, type Release } from "@/lib/api";
import styles from "./releases.module.css";

function badge(status: Release["status"]) {
  if (status === "LIVE") return { label: "Live", cls: styles.badgeLive };
  if (status === "PENDING_DNS") return { label: "Menunggu DNS", cls: styles.badgePendingDns };
  return { label: "Staged (preview saja)", cls: styles.badgeStaged };
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

/** Reads every picked folder file into memory and zips it client-side (fflate), preserving the folder's own relative paths - the API unzips this the same way it would a hand-made build/dist.zip. */
async function zipFolder(files: File[]): Promise<File> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const buffer = await file.arrayBuffer();
    entries[relPath] = new Uint8Array(buffer);
  }
  const zipped = zipSync(entries, { level: 6 });
  return new File([zipped], "folder-release.zip", { type: "application/zip" });
}

/**
 * "Semua yang menghasilkan file script bisa langsung di-release ke Caddy" -
 * upload a zip/dist build or a single .html file (or use the "Release" link
 * inline on a chat/meeting attachment), preview it in a new tab, then pick
 * a subdomain, add the DNS record yourself at your provider, and go live.
 */
export default function ReleasesPanel({ initialReleases }: { initialReleases: Release[] }) {
  const [releases, setReleases] = useState(initialReleases);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // per-release UI state, keyed by release id
  const [subdomainInput, setSubdomainInput] = useState<Record<string, string>>({});
  const [dnsHint, setDnsHint] = useState<Record<string, { host: string; value: string } | null>>({});
  const [dnsCheckMsg, setDnsCheckMsg] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});

  async function refresh() {
    const next = await api.listReleases().catch(() => releases);
    setReleases(next);
  }

  async function upload(file: File) {
    if (!title.trim()) {
      setError("Isi nama release dulu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const release = await api.createRelease(title.trim(), { file });
      setTitle("");
      await refresh();
      window.open(api.releasePreviewUrl(release.id), "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat release.");
    } finally {
      setBusy(false);
    }
  }

  async function onPickZipOrHtml(files: File[]) {
    if (files.length === 0) return;
    await upload(files[0]);
  }

  async function onPickFolder(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const zipped = await zipFolder(files);
      await upload(zipped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan folder.");
      setBusy(false);
    }
  }

  function openPreview(release: Release) {
    window.open(api.releasePreviewUrl(release.id), "_blank");
  }

  async function submitSubdomain(release: Release) {
    const subdomain = (subdomainInput[release.id] ?? "").trim().toLowerCase();
    if (!subdomain) return;
    setRowBusy((p) => ({ ...p, [release.id]: true }));
    setDnsCheckMsg((p) => ({ ...p, [release.id]: "" }));
    try {
      const res = await api.setReleaseSubdomain(release.id, subdomain);
      setDnsHint((p) => ({ ...p, [release.id]: { host: res.dnsInstructions.host, value: res.dnsInstructions.value } }));
      await refresh();
    } catch (e) {
      setDnsCheckMsg((p) => ({ ...p, [release.id]: e instanceof Error ? e.message : "Gagal menyimpan subdomain." }));
    } finally {
      setRowBusy((p) => ({ ...p, [release.id]: false }));
    }
  }

  async function checkAndGoLive(release: Release) {
    setRowBusy((p) => ({ ...p, [release.id]: true }));
    setDnsCheckMsg((p) => ({ ...p, [release.id]: "Mengecek DNS…" }));
    try {
      const check = await api.checkReleaseDns(release.id);
      if (!check.matches) {
        setDnsCheckMsg((p) => ({
          ...p,
          [release.id]: `DNS ${check.host} belum mengarah ke ${check.expected || "IP VPS"} (ditemukan: ${
            check.records.join(", ") || "tidak ada"
          }). Tambahkan A record di DNS provider, tunggu beberapa menit untuk propagasi, lalu coba lagi.`,
        }));
        return;
      }
      await api.goLiveRelease(release.id);
      setDnsCheckMsg((p) => ({ ...p, [release.id]: "" }));
      await refresh();
    } catch (e) {
      setDnsCheckMsg((p) => ({ ...p, [release.id]: e instanceof Error ? e.message : "Gagal go-live." }));
    } finally {
      setRowBusy((p) => ({ ...p, [release.id]: false }));
    }
  }

  async function takeDown(release: Release) {
    setRowBusy((p) => ({ ...p, [release.id]: true }));
    try {
      await api.takeDownRelease(release.id);
      await refresh();
    } finally {
      setRowBusy((p) => ({ ...p, [release.id]: false }));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Release</h1>
      </div>
      <p className={styles.lead}>
        Upload hasil build/dist (zip) atau satu file .html, preview dulu di tab baru, lalu pilih subdomain. Tambahkan A
        record-nya sendiri di DNS provider Anda - begitu DNS terdeteksi mengarah ke VPS ini, klik "Cek DNS & Go Live"
        untuk langsung publik di subdomain-nya.
      </p>

      <div className={styles.createCard}>
        <input
          className={styles.textInput}
          placeholder="Nama release, misalnya: Landing Page Promo Q1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className={styles.pickRow}>
          <label className={styles.pickButton} htmlFor="release-zip">
            {busy ? "Memproses…" : "📦 Upload .zip / .html"}
          </label>
          <input
            id="release-zip"
            type="file"
            accept=".zip,.html,.htm"
            className={styles.hiddenInput}
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onPickZipOrHtml(files);
              e.target.value = "";
            }}
          />
          <label className={styles.pickButton} htmlFor="release-folder">
            📁 Upload folder situs
          </label>
          <input
            id="release-folder"
            type="file"
            multiple
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            className={styles.hiddenInput}
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onPickFolder(files);
              e.target.value = "";
            }}
          />
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      {releases.length === 0 && <p className={styles.empty}>Belum ada release.</p>}

      {releases.map((release) => {
        const b = badge(release.status);
        const busyRow = !!rowBusy[release.id];
        const hint = dnsHint[release.id];
        return (
          <div key={release.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <p className={styles.cardTitle}>{release.title}</p>
                <span className={styles.cardSlug}>{release.slug}</span>
              </div>
              <span className={`${styles.badge} ${b.cls}`}>{b.label}</span>
            </div>

            <div className={styles.cardActions}>
              <button className={styles.secondaryButton} onClick={() => openPreview(release)}>
                👁 Preview
              </button>
              {release.status === "LIVE" && release.liveUrl && (
                <a href={release.liveUrl} target="_blank" rel="noreferrer" className={styles.liveLink}>
                  🌐 {release.liveUrl}
                </a>
              )}
              {release.status === "LIVE" && (
                <button className={styles.dangerButton} disabled={busyRow} onClick={() => takeDown(release)}>
                  {busyRow ? "…" : "Nonaktifkan"}
                </button>
              )}
            </div>

            {release.status === "STAGED" && (
              <div className={styles.subdomainRow}>
                <input
                  className={styles.textInput}
                  placeholder="nama-subdomain"
                  value={subdomainInput[release.id] ?? ""}
                  onChange={(e) => setSubdomainInput((p) => ({ ...p, [release.id]: e.target.value }))}
                />
                <span className={styles.subdomainSuffix}>.vraxen-group.com</span>
                <button
                  className={styles.primaryButton}
                  disabled={busyRow || !(subdomainInput[release.id] ?? "").trim()}
                  onClick={() => submitSubdomain(release)}
                >
                  {busyRow ? "…" : "Pilih subdomain"}
                </button>
              </div>
            )}

            {(release.status === "PENDING_DNS" || hint) && (
              <div className={styles.dnsBox}>
                <p>
                  Tambahkan DNS record ini di DNS provider Anda:
                  <br />
                  Type <code>A</code> · Host <code>{hint?.host ?? `${release.subdomain}.vraxen-group.com`}</code> · Value{" "}
                  <code>{hint?.value}</code>
                </p>
                {dnsCheckMsg[release.id] && <p>{dnsCheckMsg[release.id]}</p>}
                <button className={styles.primaryButton} disabled={busyRow} onClick={() => checkAndGoLive(release)}>
                  {busyRow ? "Mengecek…" : "Cek DNS & Go Live"}
                </button>
              </div>
            )}

            <p className={styles.cardSlug}>
              Dibuat {formatTime(release.createdAt)}
              {release.publishedAt && ` · Live sejak ${formatTime(release.publishedAt)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
