"use client";

/**
 * Low-poly office workers built from rounded boxes - legs, arms, torso,
 * head and hair - with no model files at all, so there is nothing to
 * fetch or fail to parse. Look (hair/skin/shirt/pants) is derived
 * deterministically from the agent's name via agentLook(). Style adapted
 * (MIT) from yugienugraha/ruang's pages/Office3D.tsx Character component.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RBox } from "./primitives";
import { agentLook } from "./agentLook";

export type Pose = "walk" | "sit" | "stand";

// Legs and arms pivot at the hip / shoulder: geometry is translated so its
// top sits at the local origin, matching where the pivot group sits.
const legGeometry = new THREE.BoxGeometry(0.17, 0.62, 0.2).translate(0, -0.31, 0);
const armGeometry = new THREE.BoxGeometry(0.12, 0.52, 0.14).translate(0, -0.26, 0);

export function Character({
  pose,
  active,
  name,
}: {
  pose: Pose;
  /** true while sitting-and-typing or standing-and-chatting */
  active?: boolean;
  name: string;
}) {
  const body = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Mesh>(null);
  const rightLeg = useRef<THREE.Mesh>(null);
  const leftArm = useRef<THREE.Mesh>(null);
  const rightArm = useRef<THREE.Mesh>(null);
  const colors = useMemo(() => agentLook(name), [name]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const walking = pose === "walk";
    const seated = pose === "sit";
    const swing = walking ? Math.sin(time * 10) * 0.6 : 0;
    if (leftLeg.current && rightLeg.current) {
      leftLeg.current.rotation.x = seated ? -Math.PI / 2.2 : swing;
      rightLeg.current.rotation.x = seated ? -Math.PI / 2.2 : -swing;
    }
    if (leftArm.current && rightArm.current) {
      const typing = !walking && seated && active;
      const talking = !walking && pose === "stand" && active;
      leftArm.current.rotation.x = walking ? -swing : typing ? -1.1 + Math.sin(time * 14) * 0.12 : talking ? -0.4 + Math.sin(time * 3) * 0.3 : 0;
      rightArm.current.rotation.x = walking ? swing : typing ? -1.1 + Math.cos(time * 14) * 0.12 : 0;
    }
    if (body.current) {
      const talk = pose === "stand" && active && !walking ? Math.abs(Math.sin(time * 5)) * 0.03 : 0;
      const breathe = !active && !walking ? Math.sin(time * 2) * 0.015 : 0;
      body.current.position.y = (seated ? -0.14 : 0) + talk + breathe;
    }
  });

  return (
    <group ref={body}>
      <mesh ref={leftLeg} position={[-0.11, 0.66, 0]} castShadow geometry={legGeometry}>
        <meshStandardMaterial color={colors.pants} roughness={0.8} />
      </mesh>
      <mesh ref={rightLeg} position={[0.11, 0.66, 0]} castShadow geometry={legGeometry}>
        <meshStandardMaterial color={colors.pants} roughness={0.8} />
      </mesh>
      <RBox position={[0, 0.98, 0]} size={[0.48, 0.58, 0.3]} radius={0.07} color={colors.shirt} roughness={0.85} />
      <mesh ref={leftArm} position={[-0.31, 1.2, 0]} castShadow geometry={armGeometry}>
        <meshStandardMaterial color={colors.shirt} roughness={0.85} />
      </mesh>
      <mesh ref={rightArm} position={[0.31, 1.2, 0]} castShadow geometry={armGeometry}>
        <meshStandardMaterial color={colors.shirt} roughness={0.85} />
      </mesh>
      <RBox position={[0, 1.5, 0]} size={[0.4, 0.4, 0.37]} radius={0.08} color={colors.skin} roughness={0.7} />
      <RBox position={[0, 1.72, -0.02]} size={[0.43, 0.13, 0.41]} radius={0.05} color={colors.hair} roughness={0.9} />
      <RBox position={[0, 1.58, -0.19]} size={[0.43, 0.3, 0.06]} radius={0.03} color={colors.hair} roughness={0.9} />
      <RBox position={[-0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false} />
      <RBox position={[0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false} />
      <RBox position={[0, 1.4, 0.186]} size={[0.12, 0.025, 0.01]} radius={0.004} color="#9a5a44" shadow={false} />
    </group>
  );
}
