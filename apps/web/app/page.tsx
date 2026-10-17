import { api } from "@/lib/api";

// Office overview: dynamic - renders whatever divisions exist right now, no
// hardcoded Software/Konten/Konstruksi/Kesehatan list. This is the Next.js
// equivalent of Ruang's HUD (crew active, gateways, tasks) but sourced from
// our own Postgres-backed API instead of shelling out to a CLI.
export default async function OfficePage() {
  const divisions = await api.listDivisions().catch(() => []);

  return (
    <div>
      <h1>Kantor Virtual</h1>
      <p style={{ color: "#94a3b8" }}>
        {divisions.length} divisi aktif. Setiap divisi bisa menjalankan beberapa task sekaligus.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginTop: 24 }}>
        {divisions.map((d: any) => (
          <a
            key={d.id}
            href={`/divisions/${d.slug}`}
            style={{ display: "block", padding: 16, borderRadius: 12, background: "#1e293b", color: "inherit", textDecoration: "none" }}
          >
            <h3 style={{ margin: 0 }}>{d.name}</h3>
            <p style={{ color: "#94a3b8", fontSize: 14 }}>{d.agentRoles?.length ?? 0} role terdaftar</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {d.agentRoles?.map((r: any) => (
                <span key={r.id} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#334155" }}>
                  {r.name} · {r.tier}
                </span>
              ))}
            </div>
          </a>
        ))}
        {divisions.length === 0 && (
          <p style={{ color: "#64748b" }}>Belum ada divisi. Mulai dari "+ Divisi Baru".</p>
        )}
      </div>
    </div>
  );
}
