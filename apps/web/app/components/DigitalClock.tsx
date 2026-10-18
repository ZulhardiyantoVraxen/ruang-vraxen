"use client";

import { useEffect, useState } from "react";
import styles from "../office.module.css";

/**
 * "Tambahkan jam digital yang sesuai dengan tema, ijo" - a small always-on
 * clock in the HUD, styled like a green LED display to match the office's
 * terminal/HUD aesthetic. Always shows Asia/Jakarta time regardless of the
 * viewer's own timezone, since that's where the actual office/director is.
 */
export default function DigitalClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null; // avoid SSR/client first-paint mismatch - render only once mounted

  const time = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  return (
    <div className={styles.digitalClock}>
      <span className={styles.digitalClockTime}>{time} WIB</span>
      <span className={styles.digitalClockDate}>{date}</span>
    </div>
  );
}
