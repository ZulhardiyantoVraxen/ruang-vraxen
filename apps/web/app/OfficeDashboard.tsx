"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import dynamic from "next/dynamic";
import styles from "./office.module.css";
import { api } from "@/lib/api";

// The 3D scene pulls in three.js + @react-three/fiber, which is a sizeable
// chunk of JS and needs a WebGL canvas - loaded only when the person
// actually switches to the 3D view, never during SSR.
const OfficeScene3D = dynamic(() => import("./three/OfficeScene3D"), {
  ssr: false,
  loading: () => <div className={styles.scene3dLoading}>Memuat kantor 3D…</div>,
});

type Agent = {
  id: string;
  displayName: string;
  status: string;
  modelVariant?: string | null;
};

type AgentRole = {
  id: string;
  name: string;
  tier: string;
  requiresApproval: boolean;
  agents: Agent[];
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: number;
  requiresApproval: boolean;
  resultSummary?: string | null;
  updatedAt: string;
};

type Division = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  agentRoles: AgentRole[];
  tasks?: Task[];
};

const TASK_STATUS_LABEL: Record<string, string> = {
  TRIAGE: "Triase",
  TODO: "Belum dikerjakan",
  SCHEDULED: "Terjadwal",
  READY: "Siap dikerjakan",
  RUNNING: "Berjalan",
  BLOCKED: "Terblokir",
  REVIEW: "Review",
  APPROVAL_PENDING: "Menunggu approval",
  DONE: "Selesai",
  REJECTED: "Ditolak",
};

const TASK_STATUS_COLOR: Record<string, string> = {
  TRIAGE: "#7f91a3",
  TODO: "#7f91a3",
  SCHEDULED: "#7f91a3",
  READY: "#5b9bd6",
  RUNNING: "#5fc9b8",
  BLOCKED: "#d6665b",
  REVIEW: "#e0a63e",
  APPROVAL_PENDING: "#9f8fe0",
  DONE: "#5fc9b8",
  REJECTED: "#d6665b",
};

type Approval = {
  id: string;
  requestedAt?: string;
  createdAt?: string;
  task?: { title?: string; division?: { name?: string } };
};

type FlatAgent = Agent & { role: string; division: string; tier: string; requiresApproval: boolean };

// Gaps are generous on purpose: the billboarded label inside each room is
// clipped to that room's own box (see .room in office.module.css), but the
// rooms themselves still need real breathing room between their projected
// diamond outlines after the 55deg/45deg isometric tilt, or the floors read
// as touching even though nothing actually overlaps.
//
// Room aspect ratio matters more than it looks: a wide-but-short box (we
// first tried Pusat as a 788x260 bar spanning the top) projects, after the
// isometric tilt, into a long THIN diagonal strip - almost none of its own
// upright (billboarded) label ends up inside that strip, so the clip above
// hides most of the content even though nothing is actually wrong with it.
// Keeping every room close to the same squarish aspect ratio as the other
// four is what makes the clip behave - so Pusat gets the same footprint,
// just centered above the 2x2 grid instead of spanning it.
const ROOM_W = 369;
const ROOM_H = 300;
const GRID_GAP_X = 50;
const GRID_GAP_Y = 60;
const FIXED_LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  pusat: { x: (ROOM_W * 2 + GRID_GAP_X - ROOM_W) / 2, y: 0, w: ROOM_W, h: ROOM_H },
  software: { x: 0, y: ROOM_H + GRID_GAP_Y, w: ROOM_W, h: ROOM_H },
  konten: { x: ROOM_W + GRID_GAP_X, y: ROOM_H + GRID_GAP_Y, w: ROOM_W, h: ROOM_H },
  konstruksi: { x: 0, y: (ROOM_H + GRID_GAP_Y) * 2, w: ROOM_W, h: ROOM_H },
  kesehatan: { x: ROOM_W + GRID_GAP_X, y: (ROOM_H + GRID_GAP_Y) * 2, w: ROOM_W, h: ROOM_H },
};

const THEME: Record<string, { floor: string; floorDark: string }> = {
  pusat: { floor: "#8a6a3a", floorDark: "#5c4624" },
  software: { floor: "#2f6a8f", floorDark: "#1d4259" },
  konten: { floor: "#9a4f78", floorDark: "#642f4c" },
  konstruksi: { floor: "#b06a2e", floorDark: "#71451f" },
  kesehatan: { floor: "#3e8a68", floorDark: "#275942" },
};
const FALLBACK_THEME = { floor: "#4a5a6a", floorDark: "#303c48" };

const STATUS_COLOR: Record<string, string> = {
  WORKING: "#5fc9b8",
  REVIEWING: "#e0a63e",
  COLLABORATING: "#9f8fe0",
  PAUSED: "#55606c",
  IDLE: "#5b6b7a",
};

const IDLE_ACTIVITIES = [
  "main game di sudut",
  "makan siang",
  "rebahan sejenak",
  "ngopi di pantry",
  "scroll berita",
  "nonton video",
  "peregangan",
  "ngobrol santai",
];

function hashString(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function idleActivity(id: string) {
  return IDLE_ACTIVITIES[hashString(id) % IDLE_ACTIVITIES.length];
}

function statusLabel(status: string, id: string) {
  if (status === "IDLE") return idleActivity(id);
  if (status === "WORKING") return "mengerjakan task";
  if (status === "REVIEWING") return "review hasil";
  if (status === "COLLABORATING") return "koordinasi lintas tim";
  if (status === "PAUSED") return "menunggu persetujuan";
  return status.toLowerCase();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeLayout(divisions: Division[]) {
  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let maxY = 0;
  for (const d of divisions) {
    if (FIXED_LAYOUT[d.slug]) {
      rects[d.slug] = FIXED_LAYOUT[d.slug];
      maxY = Math.max(maxY, FIXED_LAYOUT[d.slug].y + FIXED_LAYOUT[d.slug].h);
    }
  }
  const extra = divisions.filter((d) => !FIXED_LAYOUT[d.slug]);
  let col = 0;
  let row = 0;
  const startY = maxY > 0 ? maxY + 60 : 0;
  for (const d of extra) {
    const x = col === 0 ? 0 : 419;
    const y = startY + row * 370;
    rects[d.slug] = { x, y, w: 369, h: 300 };
    maxY = Math.max(maxY, y + 300);
    col = (col + 1) % 2;
    if (col === 0) row += 1;
  }
  return { rects, planW: 788, planH: maxY };
}

const FLOW_STEPS = [
  { title: "Tim butuh sesuatu dari developer", body: "Permintaan apa pun ke tim Software tidak langsung ke Developer — disampaikan dulu ke PM divisi masing-masing." },
  { title: "PM divisi meneruskan ke PM Software", body: "PM pemohon merumuskan kebutuhan lalu mengoordinasikannya dengan PM Software, bukan lintas divisi langsung." },
  { title: "PM Software membagi ke Analis/Developer", body: "PM Software menilai beban kerja dan menugaskan ke Analis atau Developer yang sesuai." },
  { title: "QA / Reviewer memeriksa hasil", body: "Sebelum dianggap selesai, hasil kerja diperiksa QA — iterasi revisi dibatasi agar tidak berputar tanpa henti." },
  { title: "Naik ke Chief of Staff bila perlu approval", body: "Keputusan berisiko (deploy produksi, arsitektur, biaya) digabungkan Chief of Staff jadi satu antrean persetujuan Anda." },
];

export default function OfficeDashboard({ divisions: initialDivisions, approvals }: { divisions: Division[]; approvals: Approval[] }) {
  const [divisions, setDivisions] = useState(initialDivisions);
  const [tab, setTab] = useState<"crew" | "stats" | "flow" | "command">("crew");
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [selected, setSelected] = useState<FlatAgent | null>(null);
  const [selectedDivisionSlug, setSelectedDivisionSlug] = useState<string | null>(null);
  const selectedDivision = divisions.find((d) => d.slug === selectedDivisionSlug) ?? null;
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(0.72);
  const [dragStart, setDragStart] = useState<{ x: number; rotation: number } | null>(null);

  // So that an agent given a command (or finishing one) visibly changes state -
  // walks to their desk, sits, types - without the person reloading the page.
  useEffect(() => {
    const id = setInterval(() => {
      api.listDivisions().then(setDivisions).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // "Perintah sekaligus": pick any number of agents (1, 2, or everyone), one
  // free-text instruction, dispatched together - each picked agent gets its
  // own Task and heads straight for its own desk to work on it.
  const [commandSelected, setCommandSelected] = useState<Set<string>>(new Set());
  const [commandText, setCommandText] = useState("");
  const [commandSending, setCommandSending] = useState(false);
  const [commandResult, setCommandResult] = useState<{ dispatched: { agentId: string; agentName: string }[]; failed: { agentId: string; agentName: string; reason: string }[] } | null>(null);
  const commandResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function toggleCommandAgent(id: string) {
    setCommandSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allAgents: FlatAgent[] = useMemo(
    () =>
      divisions.flatMap((d) =>
        d.agentRoles.flatMap((r) =>
          r.agents.map((a) => ({ ...a, role: r.name, division: d.name, tier: r.tier, requiresApproval: r.requiresApproval }))
        )
      ),
    [divisions]
  );

  async function sendCommand() {
    const agentIds = Array.from(commandSelected);
    if (agentIds.length === 0 || !commandText.trim() || commandSending) return;
    setCommandSending(true);
    if (commandResultTimer.current) clearTimeout(commandResultTimer.current);
    try {
      const result = await api.broadcastCommand(agentIds, commandText.trim());
      setCommandResult(result);
      setCommandText("");
      setCommandSelected(new Set());
      // Poll right away so the office visibly reacts instead of waiting for
      // the next 4s tick.
      api.listDivisions().then(setDivisions).catch(() => {});
      commandResultTimer.current = setTimeout(() => setCommandResult(null), 15000);
    } catch {
      setCommandResult({ dispatched: [], failed: agentIds.map((id) => ({ agentId: id, agentName: id, reason: "Gagal mengirim perintah" })) });
    } finally {
      setCommandSending(false);
    }
  }

  const counts = useMemo(() => {
    const by = (status: string) => allAgents.filter((a) => a.status === status).length;
    return {
      total: allAgents.length,
      working: by("WORKING"),
      reviewing: by("REVIEWING"),
      collaborating: by("COLLABORATING"),
      idle: by("IDLE"),
    };
  }, [allAgents]);

  const layout = useMemo(() => computeLayout(divisions), [divisions]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    setDragStart({ x: e.clientX, rotation });
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    setRotation(clamp(dragStart.rotation + dx * 0.3, -55, 55));
  }
  function endDrag() {
    setDragStart(null);
  }
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setZoom((z) => clamp(z - e.deltaY * 0.0012, 0.4, 1.35));
  }

  const totalZ = 45 + rotation;
  const counterTransform = `scale(${1 / zoom}) rotateZ(${-totalZ}deg) rotateX(-55deg)`;

  const crewByDivision = divisions.map((d) => ({
    name: d.name,
    agents: d.agentRoles.flatMap((r) => r.agents.map((a) => ({ ...a, role: r.name, division: d.name, tier: r.tier, requiresApproval: r.requiresApproval }))),
  }));

  return (
    <div className={styles.page}>
      <div className={styles.hud}>
        <h1 className={styles.hudTitle}>Kantor Virtual</h1>
        <div className={styles.chip}>
          <span className={styles.chipValue}>{counts.total}</span>
          <span className={styles.chipLabel}>Agent</span>
        </div>
        <div className={styles.chip}>
          <span className={styles.chipValue} style={{ color: STATUS_COLOR.WORKING }}>{counts.working}</span>
          <span className={styles.chipLabel}>Bekerja</span>
        </div>
        <div className={styles.chip}>
          <span className={styles.chipValue} style={{ color: STATUS_COLOR.REVIEWING }}>{counts.reviewing}</span>
          <span className={styles.chipLabel}>Review</span>
        </div>
        <div className={styles.chip}>
          <span className={styles.chipValue} style={{ color: STATUS_COLOR.IDLE }}>{counts.idle}</span>
          <span className={styles.chipLabel}>Standby</span>
        </div>
        <div className={styles.chip}>
          <span className={styles.chipValue}>{approvals.length}</span>
          <span className={styles.chipLabel}>Approval</span>
        </div>
        <div className={styles.viewToggle}>
          <button
            type="button"
            className={`${styles.viewToggleButton} ${view === "3d" ? styles.viewToggleButtonActive : ""}`}
            onClick={() => setView("3d")}
          >
            3D
          </button>
          <button
            type="button"
            className={`${styles.viewToggleButton} ${view === "2d" ? styles.viewToggleButtonActive : ""}`}
            onClick={() => setView("2d")}
          >
            2D
          </button>
        </div>
        <p className={styles.hudSub}>
          {divisions.length} divisi aktif · klik agent untuk detail
          {view === "2d" ? ", seret kantor untuk melihat dari sisi lain" : ", seret untuk putar kamera · scroll untuk zoom"}
        </p>
      </div>

      <div className={styles.layoutRow}>
        {view === "3d" ? (
          <div className={styles.stage3d}>
            <OfficeScene3D divisions={divisions} onSelectDivision={setSelectedDivisionSlug} selectedAgentIds={commandSelected} />
          </div>
        ) : (
        <div
          className={styles.stage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onWheel={onWheel}
        >
          <div className={styles.worldViewport}>
            <div
              className={styles.world}
              style={{
                width: layout.planW,
                height: layout.planH,
                transform: `rotateX(55deg) rotateZ(${totalZ}deg) scale(${zoom})`,
              }}
            >
              {divisions.map((d) => {
                const rect = layout.rects[d.slug];
                if (!rect) return null;
                const theme = THEME[d.slug] ?? FALLBACK_THEME;
                const agents = d.agentRoles.flatMap((r) =>
                  r.agents.map((a) => ({ ...a, role: r.name, division: d.name, tier: r.tier, requiresApproval: r.requiresApproval }))
                );
                return (
                  <div
                    key={d.id}
                    className={styles.room}
                    style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                  >
                    <div
                      className={styles.roomFloor}
                      style={{ background: `linear-gradient(160deg, ${theme.floor}, ${theme.floorDark})` }}
                    />
                    <div className={styles.roomInner} style={{ transform: counterTransform }}>
                      <div className={styles.roomLabel}>{d.name}</div>
                      {d.description && <div className={styles.roomDesc}>{d.description}</div>}
                      <div className={styles.roomTags}>
                        {agents.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            className={styles.tag}
                            onClick={() => setSelected(a)}
                            title={`${a.displayName} · ${a.role}`}
                          >
                            <span className={styles.tagDot} style={{ background: STATUS_COLOR[a.status] ?? "#5b6b7a" }} />
                            <span className={styles.tagText}>
                              <span className={styles.tagName}>{a.displayName}</span>
                              <br />
                              <span className={styles.tagMeta}>{statusLabel(a.status, a.id)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className={styles.hint}>Seret untuk memutar · scroll untuk zoom</p>
        </div>
        )}

        <div className={styles.panel}>
          <div className={styles.tabs}>
            <button className={`${styles.tabButton} ${tab === "crew" ? styles.tabButtonActive : ""}`} onClick={() => setTab("crew")}>
              Crew
            </button>
            <button className={`${styles.tabButton} ${tab === "stats" ? styles.tabButtonActive : ""}`} onClick={() => setTab("stats")}>
              Stats
            </button>
            <button className={`${styles.tabButton} ${tab === "flow" ? styles.tabButtonActive : ""}`} onClick={() => setTab("flow")}>
              Alur Kerja
            </button>
            <button className={`${styles.tabButton} ${tab === "command" ? styles.tabButtonActive : ""}`} onClick={() => setTab("command")}>
              Perintah
            </button>
          </div>

          <div className={styles.tabBody} key={tab}>
            {tab === "command" && (
              <div>
                <p className={styles.commandIntro}>
                  Pilih siapa saja - satu, dua, atau semua - lalu ketik satu perintah. Setiap yang dipilih langsung dapat task sendiri dan
                  duduk di mejanya masing-masing untuk mengerjakannya.
                </p>
                <div className={styles.commandToolbar}>
                  <button type="button" className={styles.commandToolbarAction} onClick={() => setCommandSelected(new Set(allAgents.map((a) => a.id)))}>
                    Pilih semua
                  </button>
                  <button type="button" className={styles.commandToolbarAction} onClick={() => setCommandSelected(new Set())}>
                    Bersihkan
                  </button>
                  <span className={styles.commandCount}>{commandSelected.size} dipilih</span>
                </div>
                <div className={styles.agentPickList}>
                  {crewByDivision.map((g) => (
                    <div key={g.name} className={styles.agentPickGroup}>
                      {g.agents.length > 0 && <p className={styles.agentPickGroupTitle}>{g.name}</p>}
                      {g.agents.map((a) => {
                        const isSelected = commandSelected.has(a.id);
                        return (
                          <div
                            key={a.id}
                            className={`${styles.agentPickRow} ${isSelected ? styles.agentPickRowSelected : ""}`}
                            onClick={() => toggleCommandAgent(a.id)}
                          >
                            <span className={styles.agentPickCheckbox}>
                              <svg viewBox="0 0 16 16" fill="none">
                                <path d="M3 8.5L6 11.5L13 4.5" stroke="#06201a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                            <span className={styles.agentPickName}>{a.displayName}</span>
                            <span className={styles.agentPickMeta}>{a.role}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <textarea
                  className={styles.commandTextarea}
                  placeholder="Contoh: Buat ringkasan progres minggu ini dan kirim ke saya..."
                  value={commandText}
                  onChange={(e) => setCommandText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendCommand();
                  }}
                />
                <div className={styles.commandSendRow}>
                  <button
                    type="button"
                    className={`${styles.commandSendButton} ${commandSending ? styles.commandSendButtonSending : ""}`}
                    disabled={commandSelected.size === 0 || !commandText.trim() || commandSending}
                    onClick={sendCommand}
                  >
                    {commandSending ? "Mengirim…" : `Kirim ke ${commandSelected.size || ""} agent`}
                  </button>
                </div>
                {commandResult && (
                  <div className={styles.commandFeedback}>
                    {commandResult.dispatched.map((d) => (
                      <div key={d.agentId} className={`${styles.commandFeedbackLine} ${styles.commandFeedbackOk}`}>
                        ✓ <span>{d.agentName} mulai mengerjakan</span>
                      </div>
                    ))}
                    {commandResult.failed.map((f) => (
                      <div key={f.agentId} className={`${styles.commandFeedbackLine} ${styles.commandFeedbackFail}`}>
                        ✕ <span>{f.agentName}: {f.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "crew" &&
              crewByDivision.map((g) => (
                <div key={g.name} className={styles.crewGroup}>
                  <p className={styles.crewGroupTitle}>{g.name}</p>
                  {g.agents.length === 0 && <p className={styles.empty}>Belum ada agent.</p>}
                  {g.agents.map((a) => (
                    <div key={a.id} className={styles.crewRow} onClick={() => setSelected(a)}>
                      <span className={styles.tagDot} style={{ background: STATUS_COLOR[a.status] ?? "#5b6b7a" }} />
                      <span className={styles.crewName}>{a.displayName}</span>
                      <span className={styles.crewRole}>· {a.role}</span>
                    </div>
                  ))}
                </div>
              ))}

            {tab === "stats" && (
              <div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>Total agent</span>
                  <span className={styles.statValue}>{counts.total}</span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>Bekerja</span>
                  <span className={styles.statValue}>{counts.working}</span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>Review</span>
                  <span className={styles.statValue}>{counts.reviewing}</span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>Koordinasi</span>
                  <span className={styles.statValue}>{counts.collaborating}</span>
                </div>
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>Standby</span>
                  <span className={styles.statValue}>{counts.idle}</span>
                </div>
                <p className={styles.crewGroupTitle} style={{ marginTop: 16 }}>
                  Menunggu persetujuan Anda
                </p>
                {approvals.length === 0 && <p className={styles.empty}>Tidak ada antrean saat ini.</p>}
                {approvals.slice(0, 6).map((ap) => (
                  <div key={ap.id} className={styles.approvalItem}>
                    <div className={styles.approvalTitle}>{ap.task?.title ?? "Permintaan approval"}</div>
                    <div className={styles.approvalMeta}>{ap.task?.division?.name ?? "—"}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === "flow" && (
              <div>
                <p className={styles.crewGroupTitle} style={{ marginBottom: 10 }}>
                  Eskalasi ke divisi Software
                </p>
                {FLOW_STEPS.map((s, i) => (
                  <div key={s.title} className={styles.flowStep}>
                    <span className={styles.flowIndex}>{i + 1}</span>
                    <span className={styles.flowText}>
                      <b>{s.title}.</b> {s.body}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div className={styles.overlay} onClick={() => setSelected(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalName}>{selected.displayName}</p>
            <p className={styles.modalRole}>
              {selected.role} · {selected.division}
            </p>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Status</span>
              <span className={styles.statValue} style={{ color: STATUS_COLOR[selected.status] ?? "#5b6b7a" }}>
                {statusLabel(selected.status, selected.id)}
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Tingkat model</span>
              <span className={styles.statValue}>{selected.tier}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Wajib approval</span>
              <span className={styles.statValue}>{selected.requiresApproval ? "Ya" : "Tidak"}</span>
            </div>
            <button type="button" className={styles.modalClose} onClick={() => setSelected(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}

      {selectedDivision && (
        <div className={styles.overlay} onClick={() => setSelectedDivisionSlug(null)}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalName}>{selectedDivision.name}</p>
            <p className={styles.modalRole}>Papan tulis divisi · apa yang sedang dikerjakan</p>
            {(() => {
              const tasks = selectedDivision.tasks ?? [];
              const done = tasks.filter((t) => t.status === "DONE").length;
              const percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : null;
              return (
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>Progres</span>
                  <span className={styles.statValue}>
                    {percent !== null ? `${percent}% (${done}/${tasks.length})` : "Belum ada task"}
                  </span>
                </div>
              );
            })()}
            <div className={styles.taskList}>
              {(selectedDivision.tasks ?? []).length === 0 && (
                <p className={styles.empty}>Belum ada task untuk divisi ini.</p>
              )}
              {(selectedDivision.tasks ?? []).map((t) => (
                <div key={t.id} className={styles.taskRow}>
                  <div className={styles.taskRowTop}>
                    <span className={styles.taskTitle}>{t.title}</span>
                    <span className={styles.taskStatus} style={{ color: TASK_STATUS_COLOR[t.status] ?? "#7f91a3" }}>
                      {TASK_STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </div>
                  {t.resultSummary && <p className={styles.taskSummary}>{t.resultSummary}</p>}
                </div>
              ))}
            </div>
            <button type="button" className={styles.modalClose} onClick={() => setSelectedDivisionSlug(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
