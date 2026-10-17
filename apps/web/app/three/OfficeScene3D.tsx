"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { Character, type Pose } from "./Character";
import { Desk, Monitor, Chair, Whiteboard, Plant, Sofa, GameTable, PantryCounter } from "./Furniture";
import {
  layoutFor,
  deskSlots,
  loungeAnchors,
  jitterDisc,
  ROW_LOUNGE,
  COMMAND_ROW_OFFSET,
  type RoomRect,
} from "./roomLayout";
import { woodFloor, carpet } from "./textures";

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

const THEME: Record<string, { floor: string; wall: string }> = {
  pusat: { floor: "#9c7a44", wall: "#6b5230" },
  software: { floor: "#2f6a8f", wall: "#214a66" },
  konten: { floor: "#9a4f78", wall: "#6c3755" },
  konstruksi: { floor: "#b06a2e", wall: "#7a4a1f" },
  kesehatan: { floor: "#3e8a68", wall: "#2a5f48" },
};
const FALLBACK_THEME = { floor: "#4a5a6a", wall: "#333e48" };

const STATUS_COLOR: Record<string, string> = {
  WORKING: "#5fc9b8",
  REVIEWING: "#e0a63e",
  COLLABORATING: "#9f8fe0",
  PAUSED: "#55606c",
  IDLE: "#6b7a89",
};

// Activities tagged "desk" keep the agent sitting right where they already
// work instead of walking to the lounge - without this, every idle agent
// (which can be most of the office on a freshly seeded org) heads for the
// same four lounge anchors and the result reads as one big crowd rather
// than a natural, lived-in office.
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

/**
 * Where an idle agent goes: their own desk ("desk" category, no walk at
 * all) or a jittered spot around a shared lounge anchor. Shared by both
 * regular desk-bound agents and PMs relocated to the command room, so
 * either one looks equally natural when idle.
 */
function buildIdleTarget(agentId: string, homeSeat: Seat, anchors: ReturnType<typeof loungeAnchors>) {
  const { category } = idleActivity(agentId);
  if (category === "desk") {
    return { pos: homeSeat.pos.clone(), facing: homeSeat.facing, kind: "sit" as const };
  }
  const anchor = anchors[category];
  const seed = hashString(agentId);
  const [jx, jz] = jitterDisc(seed, anchor.radius);
  const pos = anchor.pos.clone().add(new THREE.Vector3(jx, 0, jz));
  const facing = Math.atan2(anchor.pos.x - pos.x, anchor.pos.z - pos.z);
  return { pos, facing, kind: anchor.kind };
}

/** The PM role+agent of a division, if it has one (role.requiresApproval). */
function findPm(d: Division): { role: AgentRole; agent: Agent } | null {
  const role = d.agentRoles.find((r) => r.requiresApproval);
  const agent = role?.agents[0];
  return role && agent ? { role, agent } : null;
}

type AgentPlan = {
  agent: Agent;
  roleName: string;
  divisionName: string;
  divisionSlug: string;
  accent: string;
  homeSeat: Seat;
  idleTarget: { pos: THREE.Vector3; facing: number; kind: "sit" | "stand" };
  pmSeat: Seat | null;
};

function AgentActor({ plan }: { plan: AgentPlan }) {
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
      if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        facingRef.current = Math.atan2(dx, dz);
      }
    } else {
      facingRef.current = THREE.MathUtils.lerp(facingRef.current, target.facing, delta * 3);
      if (status === "COLLABORATING" && bubbleTimer.current <= 0) {
        bubbleTimer.current = 4;
      }
    }
    if (bubbleTimer.current > 0) {
      bubbleTimer.current -= delta;
      if (!showBubble) setShowBubble(true);
    } else if (showBubble) {
      setShowBubble(false);
    }
    group.current.position.copy(current.current);
    group.current.rotation.y = facingRef.current;
  });

  const walkingNow = current.current.distanceTo(target.pos) > 0.05;
  const effectivePose: Pose = walkingNow ? "walk" : pose;

  return (
    <group ref={group} position={plan.homeSeat.pos}>
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

function RoomNameTag({ rect, label, accent }: { rect: RoomRect; label: string; accent: string }) {
  return (
    <Html position={[rect.x, 2.55, rect.z + rect.d / 2 + 0.1]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
      <div
        style={{
          fontFamily: "var(--font-sans, system-ui), sans-serif",
          fontSize: 13,
          fontWeight: 700,
          color: "#eef3f7",
          background: "rgba(10,17,25,0.72)",
          border: `1px solid ${accent}99`,
          padding: "4px 11px",
          borderRadius: 9,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </Html>
  );
}

function Room({
  slug,
  name,
  rect,
  roleCount,
  commandCount,
  tasks,
  onSelect,
}: {
  slug: string;
  name: string;
  rect: RoomRect;
  roleCount: number;
  commandCount: number;
  tasks: Task[];
  onSelect: (slug: string) => void;
}) {
  const theme = THEME[slug] ?? FALLBACK_THEME;
  const slots = useMemo(() => deskSlots(rect, roleCount), [rect, roleCount]);
  const commandSlots = useMemo(
    () => (commandCount > 0 ? deskSlots(rect, commandCount, COMMAND_ROW_OFFSET) : []),
    [rect, commandCount]
  );
  const floorTex = useMemo(() => woodFloor([rect.w / 2, rect.d / 2]), [rect.w, rect.d]);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : null;

  const whiteboardPos: [number, number, number] = [rect.x - rect.w / 2 + 0.75, 1.1, rect.z - rect.d / 2 + 0.06];

  return (
    <group>
      <mesh position={[rect.x, 0, rect.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[rect.w, rect.d]} />
        <meshStandardMaterial map={floorTex} color={theme.floor} roughness={0.75} />
      </mesh>
      <mesh position={[rect.x, 0.75, rect.z - rect.d / 2]} castShadow>
        <boxGeometry args={[rect.w, 1.5, 0.08]} />
        <meshStandardMaterial color={theme.wall} roughness={0.9} />
      </mesh>

      <RoomNameTag rect={rect} label={name} accent={theme.floor} />

      <group
        position={whiteboardPos}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(slug);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <Whiteboard accent={theme.floor} />
      </group>
      <Html
        position={[whiteboardPos[0], whiteboardPos[1] + 1.15, whiteboardPos[2] + 0.1]}
        center
        distanceFactor={9}
        // drei's <Html> only forwards {ref, style, className, children} to
        // the actual DOM node it renders - any onClick/onPointerOver passed
        // to <Html> itself lands on its (otherwise empty) three.js group
        // wrapper instead, where nothing is ever there to raycast against,
        // so the handler can never fire. The click handler has to live on
        // this inner <div>, which is real DOM content.
        style={{ pointerEvents: "auto" }}
      >
        <div
          onClick={() => onSelect(slug)}
          style={{
            fontFamily: "var(--font-sans, system-ui), sans-serif",
            textAlign: "center",
            background: "rgba(10,17,25,0.82)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 8,
            padding: "4px 10px",
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: percent !== null ? "#5fc9b8" : "#7f91a3" }}>
            {percent !== null ? `${percent}% selesai` : "Belum ada task"}
          </div>
          {total > 0 && <div style={{ fontSize: 9.5, color: "rgba(238,243,247,0.65)" }}>{total} task · klik untuk detail</div>}
        </div>
      </Html>

      <group position={[rect.x + rect.w / 2 - 0.4, 0, rect.z + rect.d / 2 - 0.4]}>
        <Plant />
      </group>
      {slots.map((s, i) => (
        <group key={i}>
          <group position={s.desk}>
            <Desk />
            <Monitor />
          </group>
          <group position={s.seat} rotation={[0, s.facing, 0]}>
            <Chair />
          </group>
        </group>
      ))}

      {commandSlots.length > 0 && (
        <>
          <Html position={[rect.x, 1.75, rect.z - rect.d / 2 + COMMAND_ROW_OFFSET + 0.75]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
            <div
              style={{
                fontFamily: "var(--font-sans, system-ui), sans-serif",
                fontSize: 10.5,
                fontWeight: 600,
                color: "#eef3f7",
                background: "rgba(156,122,68,0.75)",
                padding: "2px 8px",
                borderRadius: 6,
                whiteSpace: "nowrap",
              }}
            >
              Meja Komando · PM
            </div>
          </Html>
          {commandSlots.map((s, i) => (
            <group key={`cmd-${i}`}>
              <group position={s.desk}>
                <Desk />
                <Monitor />
              </group>
              <group position={s.seat} rotation={[0, s.facing, 0]}>
                <Chair color="#6b5230" />
              </group>
            </group>
          ))}
        </>
      )}
    </group>
  );
}

function Lounge() {
  const anchors = useMemo(() => loungeAnchors(0), []);
  const rug = useMemo(() => carpet("#5b7c8c", [4, 2]), []);
  return (
    <group>
      <mesh position={[0, 0, ROW_LOUNGE]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7.6, 3.2]} />
        <meshStandardMaterial map={rug} roughness={0.9} />
      </mesh>
      <group position={[anchors.sofa.pos.x + 0.35, 0, anchors.sofa.pos.z]}>
        <Sofa />
      </group>
      <group position={[anchors.game.pos.x, 0, anchors.game.pos.z]}>
        <GameTable />
      </group>
      <group position={[anchors.pantry.pos.x - 0.25, 0, anchors.pantry.pos.z - 0.75]}>
        <PantryCounter />
      </group>
      <Html position={[-2.0, 1.3, ROW_LOUNGE - 1.4]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
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

export default function OfficeScene3D({
  divisions,
  onSelectDivision,
}: {
  divisions: Division[];
  onSelectDivision?: (slug: string) => void;
}) {
  const layout = useMemo(() => layoutFor(divisions.map((d) => d.slug)), [divisions]);
  const anchors = useMemo(() => loungeAnchors(0), []);
  const handleSelect = (slug: string) => onSelectDivision?.(slug);

  // "Pusat dan PM dibuatkan ruang terpisah, karena itu area komando": every
  // division's PM (its requiresApproval role) relocates out of their own
  // division's desk row into a second, dedicated row inside the Pusat
  // room - Pusat's own roster stays put, since Pusat already *is* the
  // command room. Teammates who go COLLABORATING now walk across the floor
  // to that PM's command desk instead of to a seat inside their own room.
  const pmByDivision = useMemo(() => {
    const map: Record<string, { role: AgentRole; agent: Agent } | null> = {};
    for (const d of divisions) map[d.slug] = d.slug === "pusat" ? null : findPm(d);
    return map;
  }, [divisions]);

  const relocatedPms = useMemo(
    () =>
      divisions
        .map((d) => ({ division: d, pm: pmByDivision[d.slug] }))
        .filter((e): e is { division: Division; pm: { role: AgentRole; agent: Agent } } => !!e.pm),
    [divisions, pmByDivision]
  );

  const pusatRect = layout["pusat"];
  const commandSlots = useMemo(
    () => (pusatRect ? deskSlots(pusatRect, relocatedPms.length, COMMAND_ROW_OFFSET) : []),
    [pusatRect, relocatedPms.length]
  );

  const plans: AgentPlan[] = useMemo(() => {
    const result: AgentPlan[] = [];

    for (const d of divisions) {
      const rect = layout[d.slug];
      if (!rect) continue;
      const relocatedPm = pmByDivision[d.slug];
      const flatAgents = d.agentRoles
        .flatMap((r) => r.agents.map((a) => ({ a, r })))
        .filter(({ a }) => a.id !== relocatedPm?.agent.id);
      const slots = deskSlots(rect, flatAgents.length);

      // Who a COLLABORATING teammate in this division walks to.
      let pmSeat: Seat | null = null;
      if (relocatedPm) {
        const idx = relocatedPms.findIndex((e) => e.pm.agent.id === relocatedPm.agent.id);
        const slot = commandSlots[idx];
        if (slot) pmSeat = { pos: slot.seat.clone(), facing: slot.facing };
      } else {
        // Pusat's own PM (if it has one) never relocates - they already
        // sit in the command room with the rest of Pusat, just a half-step
        // forward of their own desk so a visiting teammate reads as
        // "stepping up to the PM" rather than "sitting at a spare desk".
        const ownPm = d.slug === "pusat" ? findPm(d) : null;
        if (ownPm) {
          const pmIndex = flatAgents.findIndex((x) => x.a.id === ownPm.agent.id);
          if (pmIndex >= 0) {
            pmSeat = { pos: slots[pmIndex].seat.clone().add(new THREE.Vector3(0, 0, -0.35)), facing: 0 };
          }
        }
      }

      flatAgents.forEach(({ a, r }, i) => {
        const slot = slots[i];
        const homeSeat: Seat = { pos: slot.seat, facing: slot.facing };
        const isPmThemself = pmSeat !== null && d.slug === "pusat" && findPm(d)?.agent.id === a.id;
        result.push({
          agent: a,
          roleName: r.name,
          divisionName: d.name,
          divisionSlug: d.slug,
          accent: THEME[d.slug]?.floor ?? FALLBACK_THEME.floor,
          homeSeat,
          idleTarget: buildIdleTarget(a.id, homeSeat, anchors),
          pmSeat: isPmThemself ? null : pmSeat,
        });
      });
    }

    // Relocated PMs get their own plan entry seated at their command desk.
    relocatedPms.forEach(({ division: d, pm }, idx) => {
      const slot = commandSlots[idx];
      if (!slot) return;
      const homeSeat: Seat = { pos: slot.seat.clone(), facing: slot.facing };
      result.push({
        agent: pm.agent,
        roleName: pm.role.name,
        divisionName: d.name,
        divisionSlug: d.slug,
        accent: THEME[d.slug]?.floor ?? FALLBACK_THEME.floor,
        homeSeat,
        idleTarget: buildIdleTarget(pm.agent.id, homeSeat, anchors),
        pmSeat: null,
      });
    });

    return result;
  }, [divisions, layout, anchors, pmByDivision, relocatedPms, commandSlots]);

  return (
    <Canvas shadows camera={{ position: [0, 15, 23], fov: 45 }} dpr={[1, 1.5]}>
      <color attach="background" args={["#0b1420"]} />
      <fog attach="fog" args={["#0b1420", 24, 46]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[6, 12, 6]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <mesh position={[0, -0.01, ROW_LOUNGE / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1b2f24" roughness={1} />
      </mesh>

      {divisions.map((d) => {
        const rect = layout[d.slug];
        if (!rect) return null;
        const relocatedPm = pmByDivision[d.slug];
        const roleCount = d.agentRoles.reduce((sum, r) => sum + r.agents.length, 0) - (relocatedPm ? 1 : 0);
        const commandCount = d.slug === "pusat" ? relocatedPms.length : 0;
        return (
          <Room
            key={d.id}
            slug={d.slug}
            name={d.name}
            rect={rect}
            roleCount={roleCount}
            commandCount={commandCount}
            tasks={d.tasks ?? []}
            onSelect={handleSelect}
          />
        );
      })}
      <Lounge />

      {plans.map((plan) => (
        <AgentActor key={plan.agent.id} plan={plan} />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 0.8, ROW_LOUNGE / 2]}
        minDistance={6}
        maxDistance={32}
        maxPolarAngle={Math.PI / 2.1}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
