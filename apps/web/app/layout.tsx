import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import NavQuestionBadge from "./components/NavQuestionBadge";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata = { title: "Vraxen Virtual Office · Agentic AI Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body
        style={{
          margin: 0,
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          background: "#0b1420",
          color: "#e8edf2",
          minHeight: "100vh",
        }}
      >
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "14px 24px",
            borderBottom: "1px solid #1c2b3a",
            background: "#0d1826",
          }}
        >
          <a
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "#e8edf2",
              fontWeight: 600,
              textDecoration: "none",
              letterSpacing: "0.01em",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "5px 12px",
                borderRadius: 8,
                background: "linear-gradient(180deg, #ffffff, #e7ebef)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vraxen-logo.png" alt="Vraxen" style={{ height: 20, width: "auto", display: "block" }} />
            </span>
            <span>Vraxen Virtual Office</span>
          </a>
          <a href="/chief-of-staff" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14 }}>
            PIC Chief of Staff
          </a>
          <a href="/divisions/new" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14 }}>
            + Divisi baru
          </a>
          <a href="/tasks" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14 }}>
            Task board
          </a>
          <a href="/approvals" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14 }}>
            Approval
          </a>
          <a href="/meetings" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14 }}>
            Rapat
          </a>
          <a href="/questions" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14, display: "inline-flex", alignItems: "center" }}>
            Pertanyaan
            <NavQuestionBadge />
          </a>
          <a href="/archive" style={{ color: "#8696a8", textDecoration: "none", fontSize: 14 }}>
            Arsip
          </a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
