"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { Character, type Pose } from "./Character";
import { Desk, Monitor, Chair, Whiteboard, Plant, Sofa, GameTable, PantryCounter } from "./Furniture";
import { layoutFor, deskSlots, loungeAnchors, jitterDisc, ROW_LOUNGE, type RoomRect } from "./roomLayout";

type Agent = { id: string; displayName: string; status: string; modelVariant?: string | null };
type AgentRole = { id: string; name: string; tier: string; requiresApproval: boolean; agents: Agent[] };
type Division = { id: string; slug: string; name: string; description?: string | null; agentRoles: AgentRole[] };

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
function idleCategory(activity: string): "game" | "pantry" | "sofa" | "stroll" {
  if (activity === "main game di sudut") return "game";
  if (activity === "makan siang" || activity === "ngopi di pantry") return "pantry";
  if (activity === "rebahan sejenak" || activity === "nonton video") return "sofa";
  return "stroll";
}
function statusLabel(status: string, id: string) {
  if (status === "IDLE") return idleActivity(id);
  if (status === "WORKING") return "mengerjakan task";
  if (status === "REVIEWING") return "review hasil";
  if (status === "COLLABORATING") return "lapor ke PM";
  if (status === "PAUSED") return "menunggu persetujuan";
  return status.toLowerCase();
}

type AgentPlan = {
  agent: Agent;
  roleName: string;
  divisionName: string;
  divisionSlug: string;
  accent: string;
  homeSeat: { pos: THREE.Vector3; facing: number };
  idleTarget: { pos: THREE.Vector3; facing: number; kind: "sit" | "stand" };
  pmSeat: { pos: THREE.Vector3; facing: number } | null;
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
      <Character accent={plan.accent} pose={effectivePose} active={active && !walkingNow} seed={hashString(plan.agent.id) % 100} />
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

function Room({ slug, rect, roleCount }: { slug: string; rect: RoomRect; roleCount: number }) {
  const theme = THEME[slug] ?? FALLBACK_THEME;
  const slots = useMemo(() => deskSlots(rect, roleCount), [rect, roleCount]);

  return (
    <group>
      <mesh position={[rect.x, 0, rect.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[rect.w, rect.d]} />
        <meshStandardMaterial color={theme.floor} roughness={0.85} />
      </mesh>
      <mesh position={[rect.x, 0.75, rect.z - rect.d / 2]} castShadow>
        <boxGeometry args={[rect.w, 1.5, 0.08]} />
        <meshStandardMaterial color={theme.wall} roughness={0.9} />
      </mesh>
      <group position={[rect.x - rect.w / 2 + 0.75, 1.1, rect.z - rect.d / 2 + 0.06]}>
        <Whiteboard accent={theme.floor} />
      </group>
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
    </group>
  );
}

function Lounge() {
  const anchors = useMemo(() => loungeAnchors(0), []);
  return (
    <group>
      <mesh position={[0, 0, ROW_LOUNGE]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7.6, 3.2]} />
        <meshStandardMaterial color="#5c4426" roughness={0.9} />
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

export default function OfficeScene3D({ divisions }: { divisions: Division[] }) {
  const layout = useMemo(() => layoutFor(divisions.map((d) => d.slug)), [divisions]);
  const anchors = useMemo(() => loungeAnchors(0), []);

  const plans: AgentPlan[] = useMemo(() => {
    const result: AgentPlan[] = [];

    for (const d of divisions) {
      const rect = layout[d.slug];
      if (!rect) continue;
      const flatAgents = d.agentRoles.flatMap((r) => r.agents.map((a) => ({ a, r })));
      const slots = deskSlots(rect, flatAgents.length);
      const pmRole = d.agentRoles.find((r) => r.requiresApproval);
      const pmAgent = pmRole?.agents[0];
      const pmIndex = pmAgent ? flatAgents.findIndex((x) => x.a.id === pmAgent.id) : -1;
      const pmSeat = pmIndex >= 0 ? { pos: slots[pmIndex].seat.clone().add(new THREE.Vector3(0, 0, -0.35)), facing: 0 } : null;

      flatAgents.forEach(({ a, r }, i) => {
        const slot = slots[i];
        const activity = idleActivity(a.id);
        const category = idleCategory(activity);
        const anchor = anchors[category];
        const seed = hashString(a.id);
        const [jx, jz] = jitterDisc(seed, anchor.radius);
        const idlePos = anchor.pos.clone().add(new THREE.Vector3(jx, 0, jz));
        // face back toward the anchor point so a cluster reads as "gathered around it"
        const facing = Math.atan2(anchor.pos.x - idlePos.x, anchor.pos.z - idlePos.z);

        result.push({
          agent: a,
          roleName: r.name,
          divisionName: d.name,
          divisionSlug: d.slug,
          accent: THEME[d.slug]?.floor ?? FALLBACK_THEME.floor,
          homeSeat: { pos: slot.seat, facing: slot.facing },
          idleTarget: { pos: idlePos, facing, kind: anchor.kind },
          pmSeat: pmAgent && pmAgent.id !== a.id ? pmSeat : null,
        });
      });
    }
    return result;
  }, [divisions, layout, anchors]);

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

      <Suspense fallback={null}>
        {divisions.map((d) => {
          const rect = layout[d.slug];
          if (!rect) return null;
          const roleCount = d.agentRoles.reduce((sum, r) => sum + r.agents.length, 0);
          return <Room key={d.id} slug={d.slug} rect={rect} roleCount={roleCount} />;
        })}
        <Lounge />

        {plans.map((plan) => (
          <AgentActor key={plan.agent.id} plan={plan} />
        ))}
      </Suspense>

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
