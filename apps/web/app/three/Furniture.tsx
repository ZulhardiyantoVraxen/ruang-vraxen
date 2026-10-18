"use client";

/**
 * Office furniture, built entirely from rounded boxes and cylinders (see
 * primitives.tsx) with procedural canvas textures where needed - no model
 * or image files. Style adapted (MIT) from yugienugraha/ruang's
 * scene3d/props.tsx.
 */

import { useMemo } from "react";
import { Cyl, Group, RBox, type Vec3 } from "./primitives";
import { screenTexture } from "./textures";

export function Chair({ position = [0, 0, 0], color = "#2f3a44" }: { position?: Vec3; color?: string }) {
  return (
    <Group position={position}>
      <RBox position={[0, 0.48, 0]} size={[0.52, 0.09, 0.5]} radius={0.04} color={color} roughness={0.9} />
      <RBox position={[0, 0.85, -0.23]} size={[0.5, 0.6, 0.07]} radius={0.04} color={color} roughness={0.9} />
      <Cyl position={[0, 0.25, 0]} radius={0.035} height={0.42} color="#8b9297" metalness={0.6} roughness={0.3} />
      {[0, 1, 2, 3, 4].map((spoke) => (
        <RBox
          key={spoke}
          position={[Math.sin((spoke / 5) * Math.PI * 2) * 0.2, 0.05, Math.cos((spoke / 5) * Math.PI * 2) * 0.2]}
          rotation={[0, (spoke / 5) * Math.PI * 2, 0]}
          size={[0.05, 0.04, 0.42]}
          radius={0.015}
          color="#2a2f33"
        />
      ))}
    </Group>
  );
}

export function Desk({ position = [0, 0, 0] }: { position?: Vec3 }) {
  return (
    <Group position={position}>
      <RBox position={[0, 0.74, 0]} size={[1.9, 0.07, 0.95]} radius={0.03} color="#d9c3a0" roughness={0.6} />
      <RBox position={[-0.9, 0.37, 0]} size={[0.06, 0.72, 0.85]} radius={0.02} color="#e7e2d8" />
      <RBox position={[0.9, 0.37, 0]} size={[0.06, 0.72, 0.85]} radius={0.02} color="#e7e2d8" />
      <RBox position={[0.55, 0.52, 0.02]} size={[0.42, 0.4, 0.8]} radius={0.02} color="#e7e2d8" />
    </Group>
  );
}

export function Monitor({ position = [0, 0, 0], active = false }: { position?: Vec3; active?: boolean }) {
  const screen = useMemo(() => screenTexture(active), [active]);
  return (
    <Group position={position}>
      <RBox position={[0, 1.13, 0.22]} size={[0.86, 0.52, 0.05]} radius={0.02} color="#1c2024" roughness={0.4} />
      <mesh position={[0, 1.13, 0.194]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.8, 0.46]} />
        <meshStandardMaterial map={screen} emissive={active ? "#ffffff" : "#000000"} emissiveMap={screen} emissiveIntensity={active ? 0.9 : 0} roughness={0.3} />
      </mesh>
      <Cyl position={[0, 0.88, 0.25]} radius={0.03} height={0.22} color="#2a2f33" />
      <RBox position={[0, 0.785, 0.28]} size={[0.3, 0.02, 0.18]} radius={0.01} color="#2a2f33" />
      <RBox position={[0, 0.79, -0.18]} size={[0.56, 0.025, 0.18]} radius={0.01} color="#3a4046" />
      <RBox position={[0.42, 0.79, -0.18]} size={[0.07, 0.03, 0.11]} radius={0.02} color="#3a4046" />
      <Cyl position={[-0.65, 0.84, -0.1]} radius={0.05} height={0.12} color="#f4efe6" />
      <Cyl position={[-0.65, 0.901, -0.1]} radius={0.043} height={0.005} color="#3b2415" />
    </Group>
  );
}

export function Whiteboard({ position = [0, 0, 0], accent = "#5fc9b8" }: { position?: Vec3; accent?: string }) {
  return (
    <Group position={position}>
      {[-0.82, 0.82].map((x) => (
        <group key={x}>
          <RBox position={[x, 0.85, 0]} size={[0.05, 1.7, 0.05]} radius={0.01} color="#9aa2a6" metalness={0.5} />
          <RBox position={[x, 0.04, 0]} size={[0.06, 0.04, 0.5]} radius={0.01} color="#6d7479" metalness={0.5} />
        </group>
      ))}
      <RBox position={[0, 1.3, 0.03]} size={[1.6, 1.0, 0.04]} radius={0.015} color="#c9ced3" metalness={0.3} />
      <mesh position={[0, 1.3, 0.052]}>
        <planeGeometry args={[1.5, 0.9]} />
        <meshStandardMaterial color="#fbfbf8" roughness={0.25} />
      </mesh>
      {([
        [-0.5, 1.5, accent],
        [0, 1.5, accent],
        [0.5, 1.5, "#2a9d8f"],
        [-0.25, 1.15, "#c62828"],
      ] as const).map(([x, y, color]) => (
        <RBox key={`${x}${y}`} position={[x, y, 0.056]} size={[0.3, 0.16, 0.004]} radius={0.004} color={color} opacity={0.85} shadow={false} />
      ))}
      <RBox position={[0, 0.82, 0.09]} size={[1.2, 0.03, 0.08]} radius={0.01} color="#9aa2a6" metalness={0.5} />
      {["#1c1f24", "#c62828", "#2f6fb5"].map((color, index) => (
        <Cyl key={color} position={[-0.2 + index * 0.15, 0.85, 0.1]} rotation={[0, 0, Math.PI / 2]} radius={0.012} height={0.12} color={color} />
      ))}
    </Group>
  );
}

export function Sofa({ position = [0, 0, 0], color = "#5b6f8c" }: { position?: Vec3; color?: string }) {
  return (
    <Group position={position}>
      <RBox position={[0, 0.28, 0]} size={[2.4, 0.36, 0.9]} radius={0.1} color={color} roughness={0.95} />
      <RBox position={[0, 0.66, -0.36]} size={[2.4, 0.62, 0.2]} radius={0.1} color={color} roughness={0.95} />
      <RBox position={[-1.12, 0.52, 0]} size={[0.2, 0.42, 0.9]} radius={0.08} color={color} roughness={0.95} />
      <RBox position={[1.12, 0.52, 0]} size={[0.2, 0.42, 0.9]} radius={0.08} color={color} roughness={0.95} />
      {[-0.5, 0.5].map((x) => (
        <RBox key={x} position={[x, 0.5, 0.05]} size={[0.95, 0.14, 0.7]} radius={0.07} color="#6e83a2" roughness={0.95} />
      ))}
      <RBox position={[-0.7, 0.72, -0.18]} size={[0.38, 0.34, 0.14]} radius={0.07} color="#e0a43a" roughness={0.95} />
    </Group>
  );
}

export function CoffeeTable({ position = [0, 0, 0] }: { position?: Vec3 }) {
  return (
    <Group position={position}>
      <RBox position={[0, 0.36, 0]} size={[1.3, 0.07, 0.7]} radius={0.03} color="#8a5a3a" roughness={0.5} />
      {[
        [-0.55, -0.27],
        [0.55, -0.27],
        [-0.55, 0.27],
        [0.55, 0.27],
      ].map(([x, z]) => (
        <Cyl key={`${x}${z}`} position={[x, 0.17, z]} radius={0.03} height={0.34} color="#2a2f33" />
      ))}
      <Cyl position={[-0.3, 0.48, 0.05]} radius={0.04} height={0.18} color="#3a1f12" opacity={0.85} />
      <Cyl position={[0.25, 0.49, 0]} radius={0.12} height={0.2} color="#dfe8e6" opacity={0.55} roughness={0.1} />
      <Cyl position={[0.25, 0.47, 0]} radius={0.1} height={0.14} color="#f1d9a6" />
    </Group>
  );
}

export function PlasticStool({ position = [0, 0, 0], color = "#e76f51" }: { position?: Vec3; color?: string }) {
  return (
    <Group position={position}>
      <Cyl position={[0, 0.42, 0]} radius={0.17} height={0.04} color={color} roughness={0.5} />
      <Cyl position={[0, 0.21, 0]} radius={0.19} top={0.15} height={0.4} color={color} roughness={0.5} segments={8} />
    </Group>
  );
}

export function GameTable({ position = [0, 0, 0] }: { position?: Vec3 }) {
  return (
    <group>
      <CoffeeTable position={position} />
      <PlasticStool position={[position[0] + 0.55, position[1], position[2] + 0.5]} color="#e76f51" />
      <PlasticStool position={[position[0] - 0.55, position[1], position[2] - 0.5]} color="#2a9d8f" />
    </group>
  );
}

export function Plant({ position = [0, 0, 0], size = 1 }: { position?: Vec3; size?: number }) {
  return (
    <Group position={position} scale={size}>
      <Cyl position={[0, 0.22, 0]} radius={0.2} top={0.26} height={0.44} color="#b0643a" roughness={0.8} />
      {([
        [0, 0.75, 0, 0.32],
        [0.14, 0.95, 0.05, 0.22],
        [-0.12, 0.92, -0.06, 0.24],
        [0, 1.12, 0, 0.18],
      ] as const).map(([x, y, z, r]) => (
        <mesh key={`${x}${y}`} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial color="#4f8a4a" roughness={0.85} flatShading />
        </mesh>
      ))}
    </Group>
  );
}

export function SmallPlant({ position = [0, 0, 0] }: { position?: Vec3 }) {
  return <Plant position={position} size={0.6} />;
}

export function GalonDispenser({ position = [0, 0, 0], rotation = 0 }: { position?: Vec3; rotation?: number }) {
  return (
    <Group position={position} rotation={rotation}>
      <RBox position={[0, 0.5, 0]} size={[0.42, 1, 0.42]} radius={0.05} color="#eef0ee" roughness={0.4} />
      <RBox position={[0, 0.72, 0.19]} size={[0.3, 0.14, 0.06]} radius={0.02} color="#c9ced0" />
      <Cyl position={[-0.07, 0.72, 0.23]} radius={0.022} height={0.06} rotation={[Math.PI / 2, 0, 0]} color="#d64545" />
      <Cyl position={[0.07, 0.72, 0.23]} radius={0.022} height={0.06} rotation={[Math.PI / 2, 0, 0]} color="#3d7fd6" />
      <RBox position={[0, 0.54, 0.16]} size={[0.28, 0.02, 0.14]} radius={0.01} color="#9aa2a6" />
      <Cyl position={[0, 1.33, 0]} radius={0.19} height={0.52} color="#5fb4f2" opacity={0.55} roughness={0.08} segments={24} />
      <Cyl position={[0, 1.05, 0]} radius={0.06} top={0.17} height={0.1} color="#5fb4f2" opacity={0.6} roughness={0.08} />
      <Cyl position={[0, 1.6, 0]} radius={0.17} height={0.03} color="#3d8fd6" opacity={0.7} />
      <Cyl position={[0, 1.3, 0]} radius={0.175} height={0.4} color="#8fd0ff" opacity={0.35} roughness={0.05} />
    </Group>
  );
}

/** A straight wall segment between two points, with a slim cap on top - adapted from ruang's Wall(). */
export function Wall({ from, to, height = 2.4 }: { from: [number, number]; to: [number, number]; height?: number }) {
  const [x1, z1] = from;
  const [x2, z2] = to;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const angle = Math.atan2(z2 - z1, x2 - x1);
  const thick = 0.18;
  return (
    <group position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]} rotation={[0, -angle, 0]}>
      <RBox position={[0, height / 2, 0]} size={[length + thick, height, thick]} radius={0.02} color="#efe6d6" roughness={0.9} />
      <RBox position={[0, height + 0.02, 0]} size={[length + thick + 0.02, 0.05, thick + 0.04]} radius={0.01} color="#d9cdb8" />
    </group>
  );
}

/** A glass pane along x = const, from `bottom` up to `top` - a room divider you can see through. */
export function GlassPanel({ x, fromZ, toZ, bottom = 0.9, top = 2.2 }: { x: number; fromZ: number; toZ: number; bottom?: number; top?: number }) {
  return (
    <RBox
      position={[x, (bottom + top) / 2, (fromZ + toZ) / 2]}
      size={[0.05, top - bottom, Math.abs(toZ - fromZ)]}
      radius={0.01}
      color="#cfe8ee"
      opacity={0.25}
      roughness={0.05}
      shadow={false}
    />
  );
}

export function LongTable({ position = [0, 0, 0], length = 4 }: { position?: Vec3; length?: number }) {
  return (
    <Group position={position}>
      <RBox position={[0, 0.74, 0]} size={[length, 0.07, 1.1]} radius={0.03} color="#8a5a3a" roughness={0.5} />
      {[-length / 2 + 0.3, length / 2 - 0.3].map((x) => (
        <group key={x}>
          <Cyl position={[x, 0.37, -0.45]} radius={0.04} height={0.74} color="#2a2f33" />
          <Cyl position={[x, 0.37, 0.45]} radius={0.04} height={0.74} color="#2a2f33" />
        </group>
      ))}
    </Group>
  );
}

export function Television({ position = [0, 0, 0] }: { position?: Vec3 }) {
  return (
    <Group position={position}>
      <RBox position={[0, 0, 0]} size={[1.5, 0.85, 0.06]} radius={0.02} color="#17191c" roughness={0.3} />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[1.38, 0.74]} />
        <meshStandardMaterial color="#1a3a44" emissive="#2d6c7a" emissiveIntensity={0.4} roughness={0.2} />
      </mesh>
    </Group>
  );
}

export function PantryCounter({ position = [0, 0, 0], rotation = 0 }: { position?: Vec3; rotation?: number }) {
  return (
    <group>
      <Group position={position} rotation={rotation}>
        <RBox position={[0, 0.45, 0]} size={[2, 0.9, 0.6]} radius={0.02} color="#f2eee6" />
        <RBox position={[0, 0.92, 0]} size={[2.05, 0.05, 0.65]} radius={0.01} color="#3a3f44" roughness={0.3} />
        <Cyl position={[-0.6, 1.07, 0]} radius={0.16} height={0.24} color="#f5f5f2" />
        <Cyl position={[-0.6, 1.2, 0]} radius={0.14} top={0.1} height={0.05} color="#d64545" />
        <Cyl position={[0.1, 1.05, 0]} radius={0.1} height={0.2} color="#dfe8e6" opacity={0.5} />
        <Cyl position={[0.1, 1.02, 0]} radius={0.085} height={0.12} color="#6b3b1e" />
        <Cyl position={[0.62, 1.06, 0]} radius={0.12} top={0.08} height={0.22} color="#b9c0c4" metalness={0.7} roughness={0.25} />
      </Group>
      <GalonDispenser position={[position[0] + 1.3, position[1], position[2] - 0.1]} />
    </group>
  );
}
