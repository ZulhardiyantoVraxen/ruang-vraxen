"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * "Di menu pertanyaan sediakan nomor yang bulat kecil warna merah, hanya
 * muncul ketika ada pertanyaan untuk saya" - a small red counter next to
 * the "Pertanyaan" nav link, visible only while the director's queue is
 * non-empty. Polls the same /questions/open the page itself reads.
 */
export default function NavQuestionBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      api
        .openQuestions()
        .then((qs) => {
          if (!cancelled) setCount(qs.length);
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (count === 0) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        marginLeft: 5,
        borderRadius: 999,
        background: "#e0524a",
        color: "#fff",
        fontSize: 10.5,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
