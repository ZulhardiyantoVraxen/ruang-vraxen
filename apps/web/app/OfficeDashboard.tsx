"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import dynamic from "next/dynamic";
import styles from "./office.module.css";
import { api } from "@/lib/api";
import ExpandableText from "./components/ExpandableText";
import DigitalClock from "./components/DigitalClock";

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
  dueAt?: string | null;
  project?: { id: string; name: string } | null;
  assignments?: { role: "EXECUTOR" | "REVIEWER"; agent: { id: string; displayName: string } }[];
};

type Project = { id: string; name: string; description?: string | null };

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
  AWAITING_DIRECTOR: "Menunggu jawaban direktur",
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
  AWAITING_DIRECTOR: "#9f8fe0",
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
// "Ruang Direktur" is not a Division from the API - it's a virtual room the
// director can call any agent into, regardless of which division's room
// they actually belong to. It sits next to Sekretariat Direksi at the top,
// same width, so the top row's total width matches the 2x2 grid below.
const DIRECTOR_ROOM_SLUG = "ruang-direktur";
const FIXED_LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  pusat: { x: 0, y: 0, w: ROOM_W, h: ROOM_H },
  [DIRECTOR_ROOM_SLUG]: { x: ROOM_W + GRID_GAP_X, y: 0, w: ROOM_W, h: ROOM_H },
  software: { x: 0, y: ROOM_H + GRID_GAP_Y, w: ROOM_W, h: ROOM_H },
  konten: { x: ROOM_W + GRID_GAP_X, y: ROOM_H + GRID_GAP_Y, w: ROOM_W, h: ROOM_H },
  konstruksi: { x: 0, y: (ROOM_H + GRID_GAP_Y) * 2, w: ROOM_W, h: ROOM_H },
  kesehatan: { x: ROOM_W + GRID_GAP_X, y: (ROOM_H + GRID_GAP_Y) * 2, w: ROOM_W, h: ROOM_H },
};

const THEME: Record<string, { floor: string; floorDark: string }> = {
  pusat: { floor: "#8a6a3a", floorDark: "#5c4624" },
  [DIRECTOR_ROOM_SLUG]: { floor: "#c9a13d", floorDark: "#8a6c22" },
  software: { floor: "#2f6a8f", floorDark: "#1d4259" },
  konten: { floor: "#9a4f78", floorDark: "#642f4c" },
  konstruksi: { floor: "#b06a2e", floorDark: "#71451f" },
  kesehatan: { floor: "#3e8a68", floorDark: "#275942" },
};
const FALLBACK_THEME = { floor: "#4a5a6a", floorDark: "#303c48" };
const CALLED_AGENTS_STORAGE_KEY = "vraxen-office-ruang-direktur-called";

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
  // Ruang Direktur is always present (not tied to a Division record).
  rects[DIRECTOR_ROOM_SLUG] = FIXED_LAYOUT[DIRECTOR_ROOM_SLUG];
  maxY = Math.max(maxY, FIXED_LAYOUT[DIRECTOR_ROOM_SLUG].y + FIXED_LAYOUT[DIRECTOR_ROOM_SLUG].h);
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

  // "Ada ruang direktur, jadi saya bisa panggil siapa saja untuk masuk ke
  // ruang direktur" - a purely client-side roster of who the director has
  // currently summoned, independent of which division they actually belong
  // to. Kept in localStorage (per-browser convenience, not shared/durable
  // state) so a refresh doesn't silently send everyone back to their desk.
  const [calledAgentIds, setCalledAgentIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALLED_AGENTS_STORAGE_KEY);
      if (raw) setCalledAgentIds(new Set(JSON.parse(raw)));
    } catch {
      // Private browsing / storage blocked - everyone just starts at their own desk.
    }
  }, []);
  function toggleCalledToDirectorRoom(agentId: string) {
    setCalledAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      try {
        window.localStorage.setItem(CALLED_AGENTS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Non-critical - the call still applies for this session even if it can't persist.
      }
      return next;
    });
  }

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
  const [commandResult, setCommandResult] = useState<{ dispatched: { agentId: string; agentName: string; queued?: boolean }[]; failed: { agentId: string; agentName: string; reason: string }[] } | null>(null);
  const commandResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Ada project yang sedang dikerjakan" + "PIC & deadline" - every command
  // can optionally be tagged to a Project and given a deadline, which then
  // shows up on the Task Board.
  const [projects, setProjects] = useState<Project[]>([]);
  const [commandProjectId, setCommandProjectId] = useState("");
  const [commandDueAt, setCommandDueAt] = useState("");
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  async function addProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await api.createProject(name);
      setProjects((prev) => [project, ...prev]);
      setCommandProjectId(project.id);
      setNewProjectName("");
    } catch {
      // Not critical enough to block the command itself - the director can retry.
    }
  }

  // Agent-detail modal: a real chat thread with just this one person, plus
  // the tasks actually assigned to them across every division. Sending a
  // message here is plain conversation by default - the API only turns it
  // into a Task when the message itself reads as a work order (see
  // api.agentChat), so chatting never shows up on the Task Board.
  type ChatLine = { id: string; role: "DIRECTOR" | "AGENT"; content: string };
  const [modalChat, setModalChat] = useState<ChatLine[]>([]);
  const [modalChatLoading, setModalChatLoading] = useState(false);
  const [modalCommandText, setModalCommandText] = useState("");
  const [modalCommandSending, setModalCommandSending] = useState(false);

  // Division modal: filter the "papan tulis" task list by report date
  // ("Divisi bisa di klik per tanggal laporannya") - purely client-side,
  // filtering the already-loaded task list by Task.updatedAt's own date.
  const [divisionDateFilter, setDivisionDateFilter] = useState("");

  // Division modal: "saya ingin bisa menambah personel didalam menu itu,
  // perannya saya yang buat, untuk nama dan model generate dari agentic AI"
  // - director types only the role name (+ optional tanggung jawab), the
  // API infers the tier and generates a name, see api.quickAddPersonnel.
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleResponsibilities, setNewRoleResponsibilities] = useState("");
  const [addingPersonnel, setAddingPersonnel] = useState(false);
  const [addPersonnelError, setAddPersonnelError] = useState<string | null>(null);

  // "Di semua menu chat ada file upload, bisa berupa apapun" - shared
  // attach-then-send pattern: picking a file uploads it immediately (via
  // api.uploadFile) and the returned id/filename sits here until the next
  // message is sent, same as attaching a file in a Claude conversation.
  type PendingAttachment = { id: string; filename: string };
  const [modalAttachment, setModalAttachment] = useState<PendingAttachment | null>(null);
  const [modalUploading, setModalUploading] = useState(false);
  const [commandAttachment, setCommandAttachment] = useState<PendingAttachment | null>(null);
  const [commandUploading, setCommandUploading] = useState(false);

  async function uploadAttachment(file: File, setUploading: (v: boolean) => void, setAttachment: (a: PendingAttachment | null) => void) {
    setUploading(true);
    try {
      const res = await api.uploadFile(file);
      setAttachment({ id: res.id, filename: res.filename });
    } catch {
      // Upload failed - just leave no attachment rather than blocking the chat/perintah box.
    } finally {
      setUploading(false);
    }
  }

  async function addPersonnel() {
    if (!selectedDivision) return;
    const roleName = newRoleName.trim();
    if (!roleName || addingPersonnel) return;
    setAddingPersonnel(true);
    setAddPersonnelError(null);
    try {
      await api.quickAddPersonnel(selectedDivision.slug, roleName, newRoleResponsibilities.trim() || undefined);
      setNewRoleName("");
      setNewRoleResponsibilities("");
      api.listDivisions().then(setDivisions).catch(() => {});
    } catch {
      setAddPersonnelError("Gagal menambah personel. Coba lagi.");
    } finally {
      setAddingPersonnel(false);
    }
  }

  useEffect(() => {
    setDivisionDateFilter("");
    setNewRoleName("");
    setNewRoleResponsibilities("");
    setAddPersonnelError(null);
  }, [selectedDivisionSlug]);

  useEffect(() => {
    setModalAttachment(null);
    if (!selected) {
      setModalChat([]);
      return;
    }
    setModalChatLoading(true);
    api
      .agentChatHistory(selected.id)
      .then(setModalChat)
      .catch(() => setModalChat([]))
      .finally(() => setModalChatLoading(false));
  }, [selected?.id]);

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

  // "Modal agent menampilkan tugas-tugasnya juga, karena 1 agent bisa lebih
  // dari 1 tugas" - scan every division's tasks for one where this agent
  // shows up in the assignment history (either role), newest first.
  const selectedAgentTasks = useMemo(() => {
    if (!selected) return [];
    return divisions
      .flatMap((d) => (d.tasks ?? []).map((t) => ({ ...t, divisionName: d.name })))
      .filter((t) => (t.assignments ?? []).some((a) => a.agent.id === selected.id))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [divisions, selected]);

  async function sendModalChat() {
    if (!selected) return;
    const message = modalCommandText.trim();
    if (!message || modalCommandSending) return;
    setModalCommandSending(true);
    const attachment = modalAttachment;
    const optimistic: ChatLine = {
      id: `pending-${Date.now()}`,
      role: "DIRECTOR",
      content: attachment ? `${message}\n\n📎 Lampiran: ${attachment.filename}` : message,
    };
    setModalChat((prev) => [...prev, optimistic]);
    setModalCommandText("");
    setModalAttachment(null);
    try {
      const result = await api.agentChat(selected.id, message, attachment?.id);
      if (result.type === "task") {
        setModalChat((prev) => [...prev, { id: `${optimistic.id}-reply`, role: "AGENT", content: result.note }]);
        // A real Task was created - refresh so "Tugas" list and the office/board reflect it.
        api.listDivisions().then(setDivisions).catch(() => {});
      } else {
        setModalChat((prev) => [...prev, { id: `${optimistic.id}-reply`, role: "AGENT", content: result.reply }]);
      }
    } catch (e) {
      setModalChat((prev) => [
        ...prev,
        { id: `${optimistic.id}-error`, role: "AGENT", content: e instanceof Error ? `(Gagal: ${e.message})` : "(Gagal mengirim pesan)" },
      ]);
    } finally {
      setModalCommandSending(false);
    }
  }

  async function sendCommand() {
    const instruction = commandText.trim();
    if (!instruction || commandSending) return;
    const agentIds = Array.from(commandSelected);
    setCommandSending(true);
    if (commandResultTimer.current) clearTimeout(commandResultTimer.current);
    try {
      if (agentIds.length > 0) {
        // Picked someone: dispatch straight to them, bypassing triage
        // entirely. Perintah Direktur mutlak - if an agent is busy, the API
        // queues it for them instead of dropping it (see `queued` below).
        const result = await api.broadcastCommand({
          agentIds,
          instruction,
          projectId: commandProjectId || undefined,
          dueAt: commandDueAt ? new Date(commandDueAt).toISOString() : undefined,
          attachmentId: commandAttachment?.id,
        });
        setCommandResult(result);
      } else {
        // Nobody picked: it's a free-standing order, not aimed at anyone in
        // particular - file it with Chief of Staff like any other request
        // to "pusat", and let the existing auto-triage (task.created ->
        // Chief of Staff's AI call) decide who actually ends up at their
        // desk working on it.
        await api.createTask({
          divisionSlug: "pusat",
          title: instruction,
          description: instruction,
          projectId: commandProjectId || undefined,
          dueAt: commandDueAt ? new Date(commandDueAt).toISOString() : undefined,
          attachmentId: commandAttachment?.id,
        });
        setCommandResult({ dispatched: [{ agentId: "pusat", agentName: "Chief of Staff (ditriase otomatis)" }], failed: [] });
      }
      setCommandText("");
      setCommandDueAt("");
      setCommandSelected(new Set());
      setCommandAttachment(null);
      // Poll right away so the office visibly reacts instead of waiting for
      // the next 4s tick.
      api.listDivisions().then(setDivisions).catch(() => {});
      commandResultTimer.current = setTimeout(() => setCommandResult(null), 15000);
    } catch {
      const failedTargets = agentIds.length > 0 ? agentIds : ["pusat"];
      setCommandResult({ dispatched: [], failed: failedTargets.map((id) => ({ agentId: id, agentName: id, reason: "Gagal mengirim perintah" })) });
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

  // 3D desk columns are placed in array order, growing left (more negative X) -
  // which is the side the Meeting Room / Ruang Direktur sits on - so later
  // entries land closer to it. "Sekretariat Direksi" (pusat) needs to be last
  // here so its desks sit right in front of Ruang Direktur. This reorder is
  // ONLY for the 3D desk layout - the 2D grid (computeLayout above) and every
  // other list keep using `divisions` in its original order.
  const divisionsFor3D = useMemo(() => {
    const pusatIndex = divisions.findIndex((d) => d.slug === "pusat");
    if (pusatIndex === -1) return divisions;
    const rest = divisions.filter((d) => d.slug !== "pusat");
    return [...rest, divisions[pusatIndex]];
  }, [divisions]);

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
        <h1 className={styles.hudTitle}>Vraxen Virtual Office</h1>
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
        <DigitalClock />
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
            <OfficeScene3D
              divisions={divisionsFor3D}
              onSelectDivision={setSelectedDivisionSlug}
              selectedAgentIds={commandSelected}
              calledAgentIds={calledAgentIds}
            />
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
              {(() => {
                const rect = layout.rects[DIRECTOR_ROOM_SLUG];
                if (!rect) return null;
                const theme = THEME[DIRECTOR_ROOM_SLUG];
                const calledAgents = allAgents.filter((a) => calledAgentIds.has(a.id));
                return (
                  <div className={styles.room} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
                    <div className={styles.roomFloor} style={{ background: `linear-gradient(160deg, ${theme.floor}, ${theme.floorDark})` }} />
                    <div className={styles.roomInner} style={{ transform: counterTransform }}>
                      <div className={styles.roomLabel}>🏛 Ruang Direktur</div>
                      <div className={styles.roomDesc}>Panggil siapa saja dari modal agent untuk masuk ke sini.</div>
                      <div className={styles.roomTags}>
                        {calledAgents.length === 0 && <p className={styles.empty}>Belum ada yang dipanggil.</p>}
                        {calledAgents.map((a) => (
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
                              <span className={styles.tagMeta}>{a.division} · dipanggil</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
              {divisions.map((d) => {
                const rect = layout.rects[d.slug];
                if (!rect) return null;
                const theme = THEME[d.slug] ?? FALLBACK_THEME;
                const agents = d.agentRoles
                  .flatMap((r) => r.agents.map((a) => ({ ...a, role: r.name, division: d.name, tier: r.tier, requiresApproval: r.requiresApproval })))
                  .filter((a) => !calledAgentIds.has(a.id)); // currently in Ruang Direktur, not at their desk
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
                  Ketik satu perintah apa saja. Pilih siapa saja - satu, dua, atau semua - kalau sudah tahu siapa yang harus mengerjakannya; setiap
                  yang dipilih langsung dapat task sendiri dan duduk di mejanya masing-masing. Kalau tidak pilih siapa-siapa, perintah tetap
                  terkirim - Chief of Staff akan membacanya dan menugaskan ke divisi/agent yang paling cocok.
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
                <div className={styles.miniRow}>
                  <select className={styles.miniSelect} value={commandProjectId} onChange={(e) => setCommandProjectId(e.target.value)}>
                    <option value="">Tanpa project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={styles.miniInput}
                    placeholder="Project baru…"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProject();
                    }}
                  />
                  <button type="button" className={styles.miniAddButton} onClick={addProject} disabled={!newProjectName.trim()}>
                    + Buat
                  </button>
                </div>
                <div className={styles.miniRow}>
                  <input
                    type="datetime-local"
                    className={styles.miniInput}
                    value={commandDueAt}
                    onChange={(e) => setCommandDueAt(e.target.value)}
                    title="Deadline (opsional)"
                  />
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
                <div className={styles.miniRow} style={{ alignItems: "center" }}>
                  <label className={styles.miniAddButton} style={{ cursor: "pointer" }}>
                    📎 {commandUploading ? "Mengunggah…" : "Lampirkan file"}
                    <input
                      type="file"
                      style={{ display: "none" }}
                      disabled={commandUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadAttachment(file, setCommandUploading, setCommandAttachment);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {commandAttachment && (
                    <span className={styles.chipLabel}>
                      {commandAttachment.filename}{" "}
                      <button type="button" onClick={() => setCommandAttachment(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>
                        ✕
                      </button>
                    </span>
                  )}
                </div>
                <div className={styles.commandSendRow}>
                  <button
                    type="button"
                    className={`${styles.commandSendButton} ${commandSending ? styles.commandSendButtonSending : ""}`}
                    disabled={!commandText.trim() || commandSending}
                    onClick={sendCommand}
                  >
                    {commandSending
                      ? "Mengirim…"
                      : commandSelected.size > 0
                        ? `Kirim ke ${commandSelected.size} agent`
                        : "Kirim ke Chief of Staff"}
                  </button>
                </div>
                {commandResult && (
                  <div className={styles.commandFeedback}>
                    {commandResult.dispatched.map((d) => (
                      <div key={d.agentId} className={`${styles.commandFeedbackLine} ${styles.commandFeedbackOk}`}>
                        ✓{" "}
                        <span>
                          {d.agentId === "pusat"
                            ? `Terkirim ke ${d.agentName} - sedang menentukan siapa yang paling cocok`
                            : d.queued
                              ? `${d.agentName} sedang sibuk - perintah diantrekan, akan dikerjakan begitu selesai`
                              : `${d.agentName} mulai mengerjakan`}
                        </span>
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
        <div
          className={styles.overlay}
          onClick={() => {
            setSelected(null);
            setModalCommandText("");
          }}
        >
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
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

            <button
              type="button"
              className={styles.callToDirectorRoomButton}
              onClick={() => toggleCalledToDirectorRoom(selected.id)}
            >
              {calledAgentIds.has(selected.id) ? "↩ Kembalikan ke divisi" : "🏛 Panggil ke Ruang Direktur"}
            </button>

            <p className={styles.modalSectionTitle}>Tugas {selected.displayName} ({selectedAgentTasks.length})</p>
            <div className={styles.taskList}>
              {selectedAgentTasks.length === 0 && <p className={styles.modalTaskEmpty}>Belum ada tugas yang tercatat.</p>}
              {selectedAgentTasks.map((t) => (
                <div key={t.id} className={styles.taskRow}>
                  <div className={styles.taskRowTop}>
                    <span className={styles.taskTitle}>{t.title}</span>
                    <span className={styles.taskStatus} style={{ color: TASK_STATUS_COLOR[t.status] ?? "#7f91a3" }}>
                      {TASK_STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </div>
                  <div className={styles.taskRowMeta}>
                    <span>{t.divisionName}</span>
                    {t.dueAt && <span>Deadline {new Date(t.dueAt).toLocaleString("id-ID")}</span>}
                    {t.project?.name && <span>Project: {t.project.name}</span>}
                  </div>
                  {t.resultSummary && (
                    <ExpandableText
                      text={t.resultSummary}
                      className={styles.taskSummary}
                      onLoadFull={() => api.taskFullText(t.id)}
                    />
                  )}
                </div>
              ))}
            </div>

            <p className={styles.modalSectionTitle}>Chat dengan {selected.displayName}</p>
            <p className={styles.modalChatHint}>
              Obrolan biasa dibalas sebagai chat saja. Kalau pesan Anda memang berupa perintah kerja, baru dicatat sebagai
              tugas di Task Board.
            </p>
            <div className={styles.modalChatThread}>
              {modalChatLoading && <p className={styles.modalTaskEmpty}>Memuat riwayat chat…</p>}
              {!modalChatLoading && modalChat.length === 0 && (
                <p className={styles.modalTaskEmpty}>Belum ada percakapan. Mulai chat di bawah.</p>
              )}
              {modalChat.map((m) => (
                <div
                  key={m.id}
                  className={`${styles.modalChatBubble} ${m.role === "DIRECTOR" ? styles.modalChatBubbleMe : styles.modalChatBubbleAgent}`}
                >
                  <ExpandableText text={m.content} lines={6} style={{ margin: 0 }} />
                </div>
              ))}
            </div>
            {modalAttachment && (
              <p className={styles.modalChatHint} style={{ marginBottom: 4 }}>
                📎 {modalAttachment.filename}{" "}
                <button type="button" onClick={() => setModalAttachment(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", textDecoration: "underline" }}>
                  hapus
                </button>
              </p>
            )}
            <div className={styles.modalCommandRow}>
              <label className={styles.modalCommandSend} style={{ cursor: "pointer" }}>
                {modalUploading ? "…" : "📎"}
                <input
                  type="file"
                  style={{ display: "none" }}
                  disabled={modalUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadAttachment(file, setModalUploading, setModalAttachment);
                    e.target.value = "";
                  }}
                />
              </label>
              <input
                className={styles.modalCommandInput}
                placeholder={`Chat dengan ${selected.displayName}…`}
                value={modalCommandText}
                onChange={(e) => setModalCommandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendModalChat();
                }}
              />
              <button
                type="button"
                className={styles.modalCommandSend}
                disabled={!modalCommandText.trim() || modalCommandSending}
                onClick={sendModalChat}
              >
                {modalCommandSending ? "Mengirim…" : "Kirim"}
              </button>
            </div>

            <button
              type="button"
              className={styles.modalClose}
              onClick={() => {
                setSelected(null);
                setModalCommandText("");
                setModalAttachment(null);
              }}
            >
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

            {/* "Ketika nama divisi diklik muncul menu untuk menampilkan nama
                personel" - every agent currently staffed in this division,
                each clickable straight into the existing chat-capable
                agent-detail modal ("saya bisa langsung bertanya ke
                personel" - that chat already exists there). */}
            <p className={styles.modalSectionTitle}>
              Personel ({selectedDivision.agentRoles.flatMap((r) => r.agents).length})
            </p>
            <div className={styles.taskList}>
              {selectedDivision.agentRoles.flatMap((r) => r.agents).length === 0 && (
                <p className={styles.modalTaskEmpty}>Belum ada personel di divisi ini.</p>
              )}
              {selectedDivision.agentRoles.map((r) =>
                r.agents.map((a) => (
                  <div
                    key={a.id}
                    className={styles.taskRow}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelected({
                        ...a,
                        role: r.name,
                        division: selectedDivision.name,
                        tier: r.tier,
                        requiresApproval: r.requiresApproval,
                      });
                      setSelectedDivisionSlug(null);
                    }}
                  >
                    <div className={styles.taskRowTop}>
                      <span className={styles.taskTitle}>{a.displayName}</span>
                      <span className={styles.taskStatus} style={{ color: STATUS_COLOR[a.status] ?? "#5b6b7a" }}>
                        {statusLabel(a.status, a.id)}
                      </span>
                    </div>
                    <div className={styles.taskRowMeta}>
                      <span>{r.name}</span>
                      <span>Tingkat {r.tier}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* "Saya ingin bisa menambah personel didalam menu itu" */}
            <p className={styles.modalSectionTitle}>Tambah personel</p>
            <p className={styles.modalChatHint}>
              Cukup isi perannya - tingkat model, serta nama dan model agentnya digenerate otomatis oleh agentic AI.
            </p>
            <input
              className={styles.modalCommandInput}
              style={{ marginBottom: 8 }}
              placeholder="Nama peran, mis. Analis Kepatuhan"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
            />
            <input
              className={styles.modalCommandInput}
              style={{ marginBottom: 8 }}
              placeholder="Tanggung jawab (opsional)"
              value={newRoleResponsibilities}
              onChange={(e) => setNewRoleResponsibilities(e.target.value)}
            />
            <button
              type="button"
              className={styles.modalCommandSend}
              disabled={!newRoleName.trim() || addingPersonnel}
              onClick={addPersonnel}
            >
              {addingPersonnel ? "Menambah…" : "+ Tambah personel"}
            </button>
            {addPersonnelError && <p className={styles.modalTaskEmpty}>{addPersonnelError}</p>}

            {/* "Divisi bisa diklik per tanggal laporannya dan progressnya" */}
            <p className={styles.modalSectionTitle} style={{ marginTop: 16 }}>
              Laporan task
            </p>
            <div className={styles.modalCommandRow}>
              <input
                type="date"
                className={styles.modalCommandInput}
                value={divisionDateFilter}
                onChange={(e) => setDivisionDateFilter(e.target.value)}
              />
              {divisionDateFilter && (
                <button type="button" className={styles.modalCommandSend} onClick={() => setDivisionDateFilter("")}>
                  Reset
                </button>
              )}
            </div>
            <div className={styles.taskList}>
              {(() => {
                const tasks = (selectedDivision.tasks ?? []).filter(
                  (t) => !divisionDateFilter || t.updatedAt.slice(0, 10) === divisionDateFilter
                );
                if (tasks.length === 0) {
                  return (
                    <p className={styles.empty}>
                      {divisionDateFilter ? "Tidak ada task pada tanggal ini." : "Belum ada task untuk divisi ini."}
                    </p>
                  );
                }
                return tasks.map((t) => (
                  <div key={t.id} className={styles.taskRow}>
                    <div className={styles.taskRowTop}>
                      <span className={styles.taskTitle}>{t.title}</span>
                      <span className={styles.taskStatus} style={{ color: TASK_STATUS_COLOR[t.status] ?? "#7f91a3" }}>
                        {TASK_STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </div>
                    <div className={styles.taskRowMeta}>
                      <span>{new Date(t.updatedAt).toLocaleString("id-ID")}</span>
                    </div>
                    {t.resultSummary && (
                      <ExpandableText
                        text={t.resultSummary}
                        className={styles.taskSummary}
                        onLoadFull={() => api.taskFullText(t.id)}
                      />
                    )}
                  </div>
                ));
              })()}
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
