"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { Character, type Pose } from "./Character";
import {
  Desk,
  Monitor,
  Chair,
  Whiteboard,
  Plant,
  Sofa,
  GameTable,
  PantryCounter,
  Wall,
  GlassPanel,
  LongTable,
  Television,
  CoffeeTable,
} from "./Furniture";
import { RBox } from "./primitives";
import { createOfficeLayout, jitterDisc, type DivisionSeed, type OfficeLayout } from "./officeLayout";
import { woodFloor, carpet } from "./textures";

/**
 * The office is ruang's original single open-plan building (workspace,
 * meeting room, lounge, pantry, game room - see officeLayout.ts), not a
 * grid of boxed rooms. The one thing this changes from ruang's original:
 * desks are grouped into a contiguous block per division instead of flat
 * hot-desking, so "Software's corner" / "Konten's corner" reads at a
 * glance. Everything dynamic (division count, roster, task progress)
 * still comes straight from Prisma via the API, as before.
 */

type Agent = { id: string; displayName: string; status: string; modelVariant?: string | null };
type AgentRole = { id: string; name: string; tier: string; requiresApproval: boolean; agents: Agent[] };
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

const THEME: Record<string, string> = {
  pusat: "#9c7a44",
  software: "#2f6a8f",
  konten: "#9a4f78",
  konstruksi: "#b06a2e",
  kesehatan: "#3e8a68",
};
const FALLBACK_ACCENT = "#4a5a6a";

const STATUS_COLOR: Record<string, string> = {
  WORKING: "#5fc9b8",
  REVIEWING: "#e0a63e",
  COLLABORATING: "#9f8fe0",
  PAUSED: "#55606c",
  IDLE: "#6b7a89",
};

const IDLE_ACTIVITIES: { label: string; category: "game" | "pantry" | "sofa" | "stroll" | "desk" }[] = [
  { label: "main game di sudut", category: "game" },
  { label: "makan siang", category: "pantry" },
  { label: "rebahan sejenak", category: "sofa" },
  { label: "ngopi di pantry", category: "pantry" },
  { label: "scroll berita", category: "desk" },
  { label: "nonton video", category: "sofa" },
  { label: "peregangan", category: "stroll" },
  { label: "ngobrol santai", category: "stroll" },
  { label: "merapikan meja", category: "desk" },
  { label: "baca dokumen", category: "desk" },
  { label: "istirahat di meja", category: "desk" },
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
  if (status === "IDLE") return idleActivity(id).label;
  if (status === "WORKING") return "mengerjakan task";
  if (status === "REVIEWING") return "review hasil";
  if (status === "COLLABORATING") return "lapor ke PM";
  if (status === "PAUSED") return "menunggu persetujuan";
  return status.toLowerCase();
}

type Seat = { pos: THREE.Vector3; facing: number };

/** Fixed idle anchors derived from the real building geometry (lounge/pantry/game room), not a grid. */
function idleAnchors(layout: OfficeLayout) {
  const { building, lounge, gameRoom, pantry } = layout;
  return {
    sofa: lounge.seats.map((p) => new THREE.Vector3(...p)),
    pantry: [new THREE.Vector3(pantry.counter[0] - 0.9, 0, pantry.counter[2] - 0.5), new THREE.Vector3(pantry.counter[0] - 0.9, 0, pantry.counter[2] + 0.8)],
    game: [
      new THREE.Vector3((gameRoom.minX + gameRoom.maxX) / 2 + 0.55, 0, (gameRoom.minZ + gameRoom.maxZ) / 2 + 0.5),
      new THREE.Vector3((gameRoom.minX + gameRoom.maxX) / 2 - 0.55, 0, (gameRoom.minZ + gameRoom.maxZ) / 2 - 0.5),
    ],
    strollCenter: new THREE.Vector3((building.minX + building.maxX) / 2, 0, 0.4),
  };
}

function buildIdleTarget(agentId: string, homeSeat: Seat, anchors: ReturnType<typeof idleAnchors>) {
  const { category } = idleActivity(agentId);
  const seed = hashString(agentId);
  if (category === "desk") return { pos: homeSeat.pos.clone(), facing: homeSeat.facing, kind: "sit" as const };
  if (category === "sofa") {
    const pos = anchors.sofa[seed % anchors.sofa.length].clone();
    return { pos, facing: Math.atan2(anchors.sofa[0].x - pos.x + 0.01, anchors.sofa[0].z - pos.z - 1), kind: "sit" as const };
  }
  if (category === "pantry") {
    const pos = anchors.pantry[seed % anchors.pantry.length].clone();
    return { pos, facing: Math.PI / 2, kind: "stand" as const };
  }
  if (category === "game") {
    const pos = anchors.game[seed % anchors.game.length].clone();
    return { pos, facing: 0, kind: "sit" as const };
  }
  const [jx, jz] = jitterDisc(seed, 2.4);
  const pos = anchors.strollCenter.clone().add(new THREE.Vector3(jx, 0, jz));
  return { pos, facing: (seed % 628) / 100, kind: "stand" as const };
}

function findPm(d: Division): { role: AgentRole; agent: Agent } | null {
  const role = d.agentRoles.find((r) => r.requiresApproval);
  const agent = role?.agents[0];
  return role && agent ? { role, agent } : null;
}

type AgentPlan = {
  agent: Agent;
  roleName: string;
  divisionName: string;
  accent: string;
  homeSeat: Seat;
  idleTarget: { pos: THREE.Vector3; facing: number; kind: "sit" | "stand" };
  pmSeat: Seat | null;
};

/** A pulsing ring under an agent picked in the "Perintah" tab - visible from any camera angle. */
function SelectionRing() {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = clock.elapsedTime;
    const s = 1 + Math.sin(t * 3) * 0.12;
    ring.current.scale.set(s, 1, s);
    const material = ring.current.material as THREE.MeshBasicMaterial;
    material.opacity = 0.55 + Math.sin(t * 3) * 0.2;
  });
  return (
    <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.42, 0.56, 28]} />
      <meshBasicMaterial color="#5fc9b8" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

function AgentActor({ plan, selected }: { plan: AgentPlan; selected?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const current = useRef(new THREE.Vector3().copy(plan.homeSeat.pos));
  const facingRef = useRef(plan.homeSeat.facing);
  const [showBubble, setShowBubble] = useState(false);
  const bubbleTimer = useRef(0);

  const { status } = plan.agent;
  let target = plan.homeSeat;
  let pose: Pose = "sit";
  let active = false;

  if (status === "IDLE") {
    target = plan.idleTarget;
    pose = plan.idleTarget.kind;
    active = plan.idleTarget.kind === "stand";
  } else if (status === "COLLABORATING" && plan.pmSeat) {
    target = plan.pmSeat;
    pose = "stand";
    active = true;
  } else if (status === "WORKING" || status === "REVIEWING") {
    target = plan.homeSeat;
    pose = "sit";
    active = true;
  } else {
    target = plan.homeSeat;
    pose = "sit";
    active = false;
  }

  useFrame((_, delta) => {
    if (!group.current) return;
    const dist = current.current.distanceTo(target.pos);
    const walking = dist > 0.05;
    if (walking) {
      const step = Math.min(dist, delta * 1.8);
      current.current.lerp(target.pos, step / Math.max(dist, 0.0001));
      const dx = target.pos.x - current.current.x;
      const dz = target.pos.z - current.current.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) facingRef.current = Math.atan2(dx, dz);
    } else {
      facingRef.current = THREE.MathUtils.lerp(facingRef.current, target.facing, delta * 3);
      if (status === "COLLABORATING" && bubbleTimer.current <= 0) bubbleTimer.current = 4;
    }
    if (bubbleTimer.current > 0) {
      bubbleTimer.current -= delta;
      if (!showBubble) setShowBubble(true);
    } else if (showBubble) setShowBubble(false);
    group.current.position.copy(current.current);
    group.current.rotation.y = facingRef.current;
  });

  const walkingNow = current.current.distanceTo(target.pos) > 0.05;
  const effectivePose: Pose = walkingNow ? "walk" : pose;

  return (
    <group ref={group} position={plan.homeSeat.pos}>
      {selected && <SelectionRing />}
      <Character name={plan.agent.id} pose={effectivePose} active={active && !walkingNow} />
      <Html position={[0, 1.55, 0]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            background: "rgba(10,17,25,0.78)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 8,
            padding: "3px 8px",
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#eef3f7" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[status] ?? "#6b7a89" }} />
            {plan.agent.displayName}
          </span>
          <span style={{ fontSize: 10, color: "rgba(238,243,247,0.68)" }}>{statusLabel(status, plan.agent.id)}</span>
        </div>
      </Html>
      {showBubble && (
        <Html position={[0, 2.05, 0]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: "#eef3f7",
              color: "#15202b",
              borderRadius: 10,
              padding: "4px 9px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-sans, system-ui), sans-serif",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
            }}
          >
            💬 Lapor progres ke {plan.roleName.includes("PM") ? plan.roleName : "PM"}
          </div>
        </Html>
      )}
    </group>
  );
}

/** One division's desk block: a tinted floor patch, a label, and its desks/chairs. */
function DivisionZone({
  layout,
  slug,
  name,
  accent,
  tasks,
  onSelect,
}: {
  layout: OfficeLayout;
  slug: string;
  name: string;
  accent: string;
  tasks: Task[];
  onSelect: (slug: string) => void;
}) {
  const zone = layout.zones.find((z) => z.slug === slug);
  const desks = layout.desks.filter((d) => d.divisionSlug === slug);
  if (!zone || zone.deskCount === 0) return null;
  const centerZ = (layout.building.minZ + layout.building.minZ + 3.2) / 2 + 1.2;
  const signZ = -0.55; // the sekat's aisle-facing edge, where the partition posts sit too
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : null;

  return (
    <group>
      <mesh position={[zone.centerX, 0.006, centerZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[zone.maxX - zone.minX, 3.6]} />
        <meshStandardMaterial color={accent} transparent opacity={0.16} roughness={0.9} />
      </mesh>
      {/* Division nameplate: a physical sign hung above the sekat's front edge, not just a floating tag. */}
      <group position={[zone.centerX, 0, signZ]}>
        <RBox position={[0, 1.45, 0]} size={[Math.min(zone.maxX - zone.minX - 0.4, 2.6), 0.42, 0.06]} radius={0.03} color={accent} roughness={0.6} />
      </group>
      <Html position={[zone.centerX, 1.45, signZ + 0.05]} center distanceFactor={10} style={{ pointerEvents: "auto" }}>
        <div
          onClick={() => onSelect(slug)}
          style={{
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            textAlign: "center",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 0.3, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>{name.toUpperCase()}</div>
        </div>
      </Html>
      <Html position={[zone.centerX, 0.95, signZ + 0.05]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            fontSize: 10,
            fontWeight: 600,
            color: percent !== null ? "#5fc9b8" : "rgba(238,243,247,0.65)",
            background: "rgba(10,17,25,0.72)",
            padding: "2px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          {percent !== null ? `${percent}% selesai` : "Belum ada task"}
        </div>
      </Html>
      {desks.map((slot, i) => (
        <group key={i}>
          <group position={slot.position}>
            <Desk />
            <Monitor />
          </group>
          <group position={slot.seat} rotation={[0, slot.facing, 0]}>
            <Chair color={`${accent}` as string} />
          </group>
        </group>
      ))}
    </group>
  );
}

function MeetingRoom({ layout }: { layout: OfficeLayout }) {
  const { minX, maxX, minZ, maxZ, table, whiteboard } = layout.meetingRoom;
  const rug = useMemo(() => carpet("#8a4b3c", [2, 2]), []);
  const doorX = (minX + maxX) / 2;
  return (
    <group>
      <mesh position={[(minX + maxX) / 2, 0.012, (minZ + maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[maxX - minX - 0.3, maxZ - minZ - 0.3]} />
        <meshStandardMaterial map={rug} roughness={0.9} />
      </mesh>
      <Wall from={[minX, minZ]} to={[maxX, minZ]} height={0.9} />
      <GlassPanel x={maxX} fromZ={minZ} toZ={maxZ} bottom={0.9} />
      <Wall from={[maxX, minZ]} to={[maxX, maxZ]} height={0.9} />
      <Wall from={[minX, minZ]} to={[doorX - 0.5, minZ]} height={0.9} />
      <Wall from={[doorX + 0.5, minZ]} to={[maxX, minZ]} height={0.9} />
      <LongTable position={[(table.x1 + table.x2) / 2, 0, table.z]} length={table.x2 - table.x1} />
      <group position={whiteboard} rotation={[0, -Math.PI / 2, 0]}>
        <Whiteboard accent="#5fc9b8" />
      </group>
      <Html position={[(minX + maxX) / 2, 1.55, minZ + 0.3]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            fontSize: 11,
            fontWeight: 600,
            color: "#eef3f7",
            background: "rgba(10,17,25,0.6)",
            padding: "3px 9px",
            borderRadius: 8,
          }}
        >
          Meeting Room
        </div>
      </Html>
    </group>
  );
}

function Lounge({ layout }: { layout: OfficeLayout }) {
  const rug = useMemo(() => carpet("#5b7c8c", [4, 2]), []);
  const { sofa, coffeeTable, tv, rug: rugRect, seats } = layout.lounge;
  return (
    <group>
      <mesh position={[rugRect.x, 0.01, rugRect.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[rugRect.w, rugRect.d]} />
        <meshStandardMaterial map={rug} roughness={0.9} />
      </mesh>
      <group position={sofa} rotation={[0, Math.PI, 0]}>
        <Sofa />
      </group>
      <CoffeeTable position={coffeeTable} />
      <group position={[tv[0], 0.8, tv[2] - 0.15]}>
        <Television />
      </group>
      {seats.map((s, i) => (
        <group key={i} />
      ))}
      <Html position={[sofa[0] - 2, 1.3, sofa[2] - 1.4]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "#eef3f7",
            background: "rgba(10,17,25,0.6)",
            padding: "3px 9px",
            borderRadius: 8,
          }}
        >
          Lounge
        </div>
      </Html>
    </group>
  );
}

function Pantry({ layout }: { layout: OfficeLayout }) {
  const tiles = useMemo(() => carpet("#e9e4da", [2, 2]), []);
  const { counter, rotation } = layout.pantry;
  return (
    <group>
      <mesh position={[counter[0] - 0.3, 0.008, counter[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2.2, 2.6]} />
        <meshStandardMaterial map={tiles} roughness={0.4} />
      </mesh>
      <PantryCounter position={counter} rotation={rotation} />
    </group>
  );
}

function GameRoom({ layout }: { layout: OfficeLayout }) {
  const { minX, maxX, minZ, maxZ } = layout.gameRoom;
  const rug = useMemo(() => carpet("#3b4170", [3, 3]), []);
  return (
    <group>
      <mesh position={[(minX + maxX) / 2, 0.006, (minZ + maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[maxX - minX, maxZ - minZ]} />
        <meshStandardMaterial map={rug} roughness={0.9} />
      </mesh>
      <Wall from={[minX, minZ]} to={[maxX, minZ]} height={0.55} />
      <Wall from={[maxX, minZ]} to={[maxX, maxZ]} height={0.55} />
      <GameTable position={[(minX + maxX) / 2, 0, (minZ + maxZ) / 2]} />
      <Plant position={[maxX - 0.5, 0, maxZ - 0.5]} />
      <Html position={[(minX + maxX) / 2, 1.3, maxZ - 0.3]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            fontSize: 11,
            fontWeight: 600,
            color: "#eef3f7",
            background: "rgba(10,17,25,0.6)",
            padding: "3px 9px",
            borderRadius: 8,
          }}
        >
          Game Room
        </div>
      </Html>
    </group>
  );
}

/** Low partition walls between adjacent divisions' desk blocks, so each corner is physically sekat. */
function DivisionPartitions({ layout }: { layout: OfficeLayout }) {
  const { minZ } = layout.building;
  const active = layout.zones.filter((z) => z.deskCount > 0);
  const fromZ = minZ + 0.05;
  const toZ = -0.55;
  return (
    <group>
      {active.slice(0, -1).map((zone, i) => {
        const x = zone.minX; // coincides with active[i + 1].maxX
        return (
          <group key={zone.slug}>
            <Wall from={[x, fromZ]} to={[x, toZ]} height={1.3} />
            <RBox position={[x, 1.32, toZ]} size={[0.3, 0.05, 0.3]} radius={0.01} color="#d9cdb8" />
          </group>
        );
      })}
    </group>
  );
}

function Building({ layout }: { layout: OfficeLayout }) {
  const { minX, maxX, minZ, maxZ } = layout.building;
  const wood = useMemo(() => woodFloor([5, 5]), []);
  return (
    <group>
      <mesh position={[(minX + maxX) / 2, 0.005, (minZ + maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[maxX - minX, maxZ - minZ]} />
        <meshStandardMaterial map={wood} color="#d9c3a0" roughness={0.55} />
      </mesh>
      <Wall from={[minX, minZ]} to={[maxX, minZ]} />
      <Wall from={[minX, minZ]} to={[minX, maxZ]} />
      <Wall from={[maxX, minZ]} to={[maxX, 0.6]} height={1.1} />
      <GlassPanel x={maxX} fromZ={minZ} toZ={0.6} bottom={1.1} top={2.6} />
      <Wall from={[minX, maxZ]} to={[4.9, maxZ]} height={0.55} />
      <Wall from={[6.7, maxZ]} to={[maxX, maxZ]} height={0.55} />
      {[-7, -3.6, 1.4, 6.6].map((x) => (
        <RBox key={x} position={[x, 1.55, minZ + 0.1]} size={[1.9, 1.22, 0.1]} radius={0.02} color="#9fd3ea" opacity={0.3} roughness={0.05} shadow={false} />
      ))}
      <DivisionPartitions layout={layout} />
      <MeetingRoom layout={layout} />
      <Lounge layout={layout} />
      <Pantry layout={layout} />
      <GameRoom layout={layout} />
      {[1.3, 2.3, 3.3].map((z) => (
        <Plant key={z} position={[minX + 0.6, 0, z]} size={0.8} />
      ))}
    </group>
  );
}

export default function OfficeScene3D({
  divisions,
  onSelectDivision,
  selectedAgentIds,
}: {
  divisions: Division[];
  onSelectDivision?: (slug: string) => void;
  /** Agents picked in the "Perintah" tab - rendered with a pulsing ring so a command's targets read at a glance. */
  selectedAgentIds?: Set<string>;
}) {
  const handleSelect = (slug: string) => onSelectDivision?.(slug);

  const pmByDivision = useMemo(() => {
    const map: Record<string, { role: AgentRole; agent: Agent } | null> = {};
    for (const d of divisions) map[d.slug] = findPm(d);
    return map;
  }, [divisions]);

  const seeds: DivisionSeed[] = useMemo(
    () =>
      divisions.map((d) => {
        const pm = pmByDivision[d.slug];
        const total = d.agentRoles.reduce((sum, r) => sum + r.agents.length, 0);
        return {
          slug: d.slug,
          name: d.name,
          deskAgentCount: Math.max(0, total - (pm ? 1 : 0)),
          accent: THEME[d.slug] ?? FALLBACK_ACCENT,
        };
      }),
    [divisions, pmByDivision]
  );

  const layout = useMemo(() => createOfficeLayout(seeds), [seeds]);
  const anchors = useMemo(() => idleAnchors(layout), [layout]);

  const pmsWithSeat = useMemo(
    () =>
      divisions
        .map((d) => ({ division: d, pm: pmByDivision[d.slug] }))
        .filter((e): e is { division: Division; pm: { role: AgentRole; agent: Agent } } => !!e.pm)
        .map((entry, index) => ({ ...entry, seat: layout.meetingRoom.seats[index % layout.meetingRoom.seats.length] })),
    [divisions, pmByDivision, layout]
  );

  const plans: AgentPlan[] = useMemo(() => {
    const result: AgentPlan[] = [];
    for (const d of divisions) {
      const pm = pmByDivision[d.slug];
      const accent = THEME[d.slug] ?? FALLBACK_ACCENT;
      const desks = layout.desks.filter((slot) => slot.divisionSlug === d.slug);
      const deskAgents = d.agentRoles.flatMap((r) => r.agents.map((a) => ({ a, r }))).filter(({ a }) => a.id !== pm?.agent.id);

      deskAgents.forEach(({ a, r }, i) => {
        const slot = desks[i];
        if (!slot) return;
        const homeSeat: Seat = { pos: new THREE.Vector3(...slot.seat), facing: slot.facing };
        const pmEntry = pmsWithSeat.find((e) => e.division.slug === d.slug);
        const pmSeat: Seat | null = pmEntry ? { pos: new THREE.Vector3(...pmEntry.seat.position), facing: pmEntry.seat.facing } : null;
        result.push({
          agent: a,
          roleName: r.name,
          divisionName: d.name,
          accent,
          homeSeat,
          idleTarget: buildIdleTarget(a.id, homeSeat, anchors),
          pmSeat,
        });
      });

      if (pm) {
        const pmEntry = pmsWithSeat.find((e) => e.pm.agent.id === pm.agent.id);
        // The PM's own desk sits one column past the division's teammates, at the
        // division's own corner, so "where the PM sits" still reads inside their zone.
        const fallbackDesk = desks[desks.length - 1] ?? { seat: [0, 0, 0] as const, facing: 0 };
        const homeSeat: Seat = pmEntry
          ? { pos: new THREE.Vector3(...pmEntry.seat.position), facing: pmEntry.seat.facing }
          : { pos: new THREE.Vector3(...fallbackDesk.seat), facing: fallbackDesk.facing };
        result.push({
          agent: pm.agent,
          roleName: pm.role.name,
          divisionName: d.name,
          accent,
          homeSeat,
          idleTarget: buildIdleTarget(pm.agent.id, homeSeat, anchors),
          pmSeat: null,
        });
      }
    }
    return result;
  }, [divisions, layout, anchors, pmByDivision, pmsWithSeat]);

  return (
    <Canvas shadows camera={{ position: [0, 15, 23], fov: 45 }} dpr={[1, 1.5]}>
      <color attach="background" args={["#0b1420"]} />
      <fog attach="fog" args={["#0b1420", 26, 52]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      <mesh position={[0, -0.02, 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[46, 36]} />
        <meshStandardMaterial color="#1b2f24" roughness={1} />
      </mesh>

      <Building layout={layout} />

      {divisions.map((d) => (
        <DivisionZone key={d.id} layout={layout} slug={d.slug} name={d.name} accent={THEME[d.slug] ?? FALLBACK_ACCENT} tasks={d.tasks ?? []} onSelect={handleSelect} />
      ))}

      {plans.map((plan) => (
        <AgentActor key={plan.agent.id} plan={plan} selected={selectedAgentIds?.has(plan.agent.id)} />
      ))}

      <OrbitControls
        makeDefault
        target={layout.camera.target}
        minDistance={6}
        maxDistance={38}
        maxPolarAngle={Math.PI / 2.1}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
