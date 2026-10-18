"use client";

import { useState, type CSSProperties } from "react";
import styles from "./expandableText.module.css";

/**
 * "Setiap ada text panjang seperti itu ada tombol read all" - a drop-in
 * wrapper for any long blob of text in the office UI (task descriptions,
 * PM/Chief of Staff result summaries, director questions, chat bubbles).
 * Clamps to a few lines by CSS and reveals the rest on click, instead of
 * every card growing to fit its longest possible output.
 *
 * Pure CSS line-clamp, so it works on text that's ALREADY fully loaded in
 * the DOM - no extra request. For text the backend itself hard-truncates
 * (e.g. Task.resultSummary, capped at 500 chars server-side), pass
 * `onLoadFull` to fetch the untruncated version lazily the first time the
 * director actually asks to see more.
 */
export default function ExpandableText({
  text,
  lines = 4,
  className,
  style,
  onLoadFull,
}: {
  text: string;
  /** How many lines to show before collapsing. */
  lines?: number;
  className?: string;
  style?: CSSProperties;
  /** Called once, lazily, the first time the director expands truncated text - should resolve the full string. */
  onLoadFull?: () => Promise<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const shown = fullText ?? text;
  // Rough heuristic for "is this worth collapsing at all" - short strings
  // never get a button even if they happen to wrap onto a couple of lines.
  const isLong = text.length > 220 || text.split("\n").length > lines;

  async function expand() {
    if (onLoadFull && fullText === null) {
      setLoading(true);
      try {
        setFullText(await onLoadFull());
      } catch {
        // Fall back to whatever's already shown (the truncated server copy) rather than blocking the toggle.
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }

  if (!isLong) {
    return (
      <p className={className} style={style}>
        {shown}
      </p>
    );
  }

  return (
    <div>
      <p
        className={className}
        style={{
          ...style,
          ...(expanded
            ? undefined
            : ({
                display: "-webkit-box",
                WebkitLineClamp: lines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              } as CSSProperties)),
        }}
      >
        {shown}
      </p>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => (expanded ? setExpanded(false) : expand())}
        disabled={loading}
      >
        {loading ? "Memuat…" : expanded ? "Sembunyikan ▴" : "Baca semua ▾"}
      </button>
    </div>
  );
}
