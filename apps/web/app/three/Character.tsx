"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A low-poly humanoid built from primitives (no imported model) - a
 * hierarchy of groups standing in for joints (shoulder/hip pivots), each
 * holding one box/sphere mesh. useFrame animates the pivots directly:
 * swinging arms/legs for a walk cycle, a bent-knee pose for sitting, a
 * small hand bob for typing, a slow breathing scale for idle.
 */

export type Pose = "walk" | "sit" | "stand";

export function Character({
  accent,
  skin = "#e0b088",
  hair = "#3a2a22",
  pose,
  active,
  seed = 0,
}: {
  accent: string;
  skin?: string;
  hair?: string;
  pose: Pose;
  /** true while sitting-and-typing or standing-and-chatting, for a little extra motion */
  active?: boolean;
  seed?: number;
}) {
  const hips = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    const walking = pose === "walk";
    const sitting = pose === "sit";

    if (hips.current) {
      hips.current.position.y = sitting ? 0.34 : walking ? 0.72 + Math.abs(Math.sin(t * 7)) * 0.03 : 0.72 + Math.sin(t * 1.6) * 0.012;
    }
    if (torso.current) {
      torso.current.rotation.x = sitting ? 0.08 : 0;
    }
    if (head.current) {
      head.current.rotation.y = walking ? 0 : Math.sin(t * 0.5) * 0.25;
      head.current.rotation.x = active && sitting ? -0.18 + Math.sin(t * 3) * 0.03 : 0;
    }
    if (armL.current && armR.current) {
      if (walking) {
        armL.current.rotation.x = Math.sin(t * 7) * 0.9;
        armR.current.rotation.x = -Math.sin(t * 7) * 0.9;
      } else if (sitting) {
        armL.current.rotation.x = -1.3 + (active ? Math.sin(t * 9) * 0.08 : 0);
        armR.current.rotation.x = -1.3 + (active ? Math.sin(t * 9 + 1.6) * 0.08 : 0);
      } else {
        armL.current.rotation.x = Math.sin(t * 1.2) * 0.06;
        armR.current.rotation.x = active ? Math.sin(t * 5) * 0.5 - 0.3 : -Math.sin(t * 1.2) * 0.06;
      }
    }
    if (legL.current && legR.current) {
      if (walking) {
        legL.current.rotation.x = -Math.sin(t * 7) * 0.8;
        legR.current.rotation.x = Math.sin(t * 7) * 0.8;
      } else if (sitting) {
        legL.current.rotation.x = -1.4;
        legR.current.rotation.x = -1.4;
      } else {
        legL.current.rotation.x = 0;
        legR.current.rotation.x = 0;
      }
    }
  });

  return (
    <group ref={hips} position={[0, 0.72, 0]}>
      {/* torso */}
      <group ref={torso}>
        <mesh position={[0, 0.27, 0]} castShadow>
          <boxGeometry args={[0.3, 0.42, 0.18]} />
          <meshStandardMaterial color={accent} roughness={0.8} />
        </mesh>

        {/* head */}
        <group ref={head} position={[0, 0.58, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.14, 14, 12]} />
            <meshStandardMaterial color={skin} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.07, 0]} scale={[1.05, 0.55, 1.05]} castShadow>
            <sphereGeometry args={[0.145, 14, 12]} />
            <meshStandardMaterial color={hair} roughness={0.9} />
          </mesh>
          <mesh position={[-0.05, 0, 0.125]}>
            <sphereGeometry args={[0.016, 8, 8]} />
            <meshStandardMaterial color="#20242a" />
          </mesh>
          <mesh position={[0.05, 0, 0.125]}>
            <sphereGeometry args={[0.016, 8, 8]} />
            <meshStandardMaterial color="#20242a" />
          </mesh>
        </group>

        {/* arms */}
        <group ref={armL} position={[-0.19, 0.42, 0]}>
          <mesh position={[0, -0.18, 0]} castShadow>
            <boxGeometry args={[0.09, 0.36, 0.09]} />
            <meshStandardMaterial color={accent} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.37, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
        <group ref={armR} position={[0.19, 0.42, 0]}>
          <mesh position={[0, -0.18, 0]} castShadow>
            <boxGeometry args={[0.09, 0.36, 0.09]} />
            <meshStandardMaterial color={accent} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.37, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
      </group>

      {/* legs */}
      <group ref={legL} position={[-0.09, 0, 0]}>
        <mesh position={[0, -0.22, 0]} castShadow>
          <boxGeometry args={[0.12, 0.44, 0.12]} />
          <meshStandardMaterial color="#2b3038" roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.44, 0.03]}>
          <boxGeometry args={[0.13, 0.07, 0.19]} />
          <meshStandardMaterial color="#17191c" />
        </mesh>
      </group>
      <group ref={legR} position={[0.09, 0, 0]}>
        <mesh position={[0, -0.22, 0]} castShadow>
          <boxGeometry args={[0.12, 0.44, 0.12]} />
          <meshStandardMaterial color="#2b3038" roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.44, 0.03]}>
          <boxGeometry args={[0.13, 0.07, 0.19]} />
          <meshStandardMaterial color="#17191c" />
        </mesh>
      </group>
    </group>
  );
}
