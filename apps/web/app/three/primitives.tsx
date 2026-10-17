"use client";

import { type ReactNode } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Low-poly building blocks for the office: rounded boxes and cylinders with
 * flat PBR materials, no model or texture files. Style adapted (MIT) from
 * yugienugraha/ruang's scene3d/props.tsx, which uses exactly this recipe
 * for its whole 3D office.
 */

export type Vec3 = [number, number, number];

const roundedCache = new Map<string, THREE.BufferGeometry>();
function roundedGeometry(size: Vec3, radius: number) {
  const key = `${size.join(",")}:${radius}`;
  let geometry = roundedCache.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(radius, ...size.map((v) => v / 2 - 0.001)));
    roundedCache.set(key, geometry);
  }
  return geometry;
}

interface MaterialProps {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  map?: THREE.Texture;
}

function Material({ color, roughness = 0.7, metalness = 0, emissive, emissiveIntensity = 0.5, opacity, map }: MaterialProps) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      metalness={metalness}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissive ? emissiveIntensity : 0}
      transparent={opacity !== undefined}
      opacity={opacity ?? 1}
      map={map}
    />
  );
}

export function RBox({
  position,
  size,
  radius = 0.04,
  rotation,
  shadow = true,
  ...material
}: { position: Vec3; size: Vec3; radius?: number; rotation?: Vec3; shadow?: boolean } & MaterialProps) {
  return (
    <mesh position={position} rotation={rotation} geometry={roundedGeometry(size, radius)} castShadow={shadow} receiveShadow>
      <Material {...material} />
    </mesh>
  );
}

export function Cyl({
  position,
  radius,
  height,
  rotation,
  segments = 20,
  top,
  ...material
}: { position: Vec3; radius: number; height: number; rotation?: Vec3; segments?: number; top?: number } & MaterialProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[top ?? radius, radius, height, segments]} />
      <Material {...material} />
    </mesh>
  );
}

export function Group({
  position = [0, 0, 0],
  rotation = 0,
  scale = 1,
  children,
}: { position?: Vec3; rotation?: number; scale?: number; children: ReactNode }) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      {children}
    </group>
  );
}
