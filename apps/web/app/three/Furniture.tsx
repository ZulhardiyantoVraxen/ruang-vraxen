"use client";

/**
 * Low-poly office furniture, built entirely from primitive geometries -
 * no imported models. Kept intentionally simple (flat-shaded boxes and
 * cylinders) so a scene with dozens of instances stays cheap to render.
 */

export function Desk({ color = "#b08a5c" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.05, 0.6]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {[
        [-0.48, -0.25],
        [0.48, -0.25],
        [-0.48, 0.25],
        [0.48, 0.25],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.19, z]} castShadow>
          <boxGeometry args={[0.05, 0.38, 0.05]} />
          <meshStandardMaterial color="#3a2f26" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function Monitor({ glow = "#5fc9b8" }: { glow?: string }) {
  return (
    <group position={[0, 0.4, -0.12]}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.07, 0.03, 0.1]} />
        <meshStandardMaterial color="#1c1f24" />
      </mesh>
      <mesh position={[0, 0.17, 0]} castShadow>
        <boxGeometry args={[0.32, 0.22, 0.03]} />
        <meshStandardMaterial color="#14171b" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.17, 0.016]}>
        <planeGeometry args={[0.27, 0.17]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Chair({ color = "#2f3a46" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.24, 0]} castShadow>
        <boxGeometry args={[0.36, 0.04, 0.36]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.45, -0.16]} castShadow>
        <boxGeometry args={[0.36, 0.42, 0.04]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.24, 8]} />
        <meshStandardMaterial color="#1a1d21" />
      </mesh>
    </group>
  );
}

export function Whiteboard({ accent = "#5fc9b8" }: { accent?: string }) {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[1.4, 0.9, 0.04]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.5} />
      </mesh>
      {[-0.4, -0.05, 0.3].map((y, i) => (
        <mesh key={i} position={[-0.15 + i * 0.12, y, 0.025]} rotation={[0, 0, -0.08]}>
          <boxGeometry args={[0.45, 0.025, 0.002]} />
          <meshStandardMaterial color={i === 1 ? accent : "#8c95a0"} />
        </mesh>
      ))}
    </group>
  );
}

export function Plant() {
  return (
    <group>
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.11, 0.26, 10]} />
        <meshStandardMaterial color="#8a5a3c" roughness={0.9} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={i}
          position={[Math.sin(i) * 0.08, 0.32 + i * 0.07, Math.cos(i * 1.3) * 0.08]}
          rotation={[0, i, Math.sin(i) * 0.3]}
          castShadow
        >
          <coneGeometry args={[0.16, 0.42, 6]} />
          <meshStandardMaterial color={i % 2 === 0 ? "#3f8a5c" : "#4fa06c"} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function Sofa({ color = "#7a5a8c" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.32, 0.6]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.5, -0.26]} castShadow>
        <boxGeometry args={[1.5, 0.5, 0.12]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {[-0.69, 0.69].map((x, i) => (
        <mesh key={i} position={[x, 0.42, 0]} castShadow>
          <boxGeometry args={[0.12, 0.34, 0.6]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

export function GameTable() {
  return (
    <group>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.04, 0.9]} />
        <meshStandardMaterial color="#1e5e3a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.39, 0]}>
        <boxGeometry args={[0.94, 0.005, 0.02]} />
        <meshStandardMaterial color="#f4f6f8" />
      </mesh>
      <mesh position={[0, 0.39, 0]}>
        <boxGeometry args={[0.02, 0.005, 0.94]} />
        <meshStandardMaterial color="#f4f6f8" />
      </mesh>
      <mesh position={[0, 0.19, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.38, 8]} />
        <meshStandardMaterial color="#3a2f26" />
      </mesh>
    </group>
  );
}

export function PantryCounter() {
  return (
    <group>
      <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.64, 0.5]} />
        <meshStandardMaterial color="#d8d2c4" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.65, 0]}>
        <boxGeometry args={[1.32, 0.03, 0.52]} />
        <meshStandardMaterial color="#3a3f46" />
      </mesh>
      <mesh position={[0.3, 0.655, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.02, 16]} />
        <meshStandardMaterial color="#9aa5b0" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[-0.35, 0.95, -0.15]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.3]} />
        <meshStandardMaterial color="#2c2f33" />
      </mesh>
    </group>
  );
}
