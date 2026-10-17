import type { ReactNode } from "react";

export const metadata = { title: "Agentic AI Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0f172a", color: "#e2e8f0" }}>
        <nav style={{ display: "flex", gap: 16, padding: "12px 20px", borderBottom: "1px solid #1e293b" }}>
          <a href="/" style={{ color: "#e2e8f0", fontWeight: 600 }}>Kantor</a>
          <a href="/divisions/new" style={{ color: "#94a3b8" }}>+ Divisi Baru</a>
          <a href="/tasks" style={{ color: "#94a3b8" }}>Task Board</a>
          <a href="/approvals" style={{ color: "#94a3b8" }}>Approval</a>
        </nav>
        <main style={{ padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
