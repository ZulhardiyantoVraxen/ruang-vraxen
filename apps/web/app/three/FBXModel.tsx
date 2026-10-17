"use client";

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { FBXLoader } from "three-stdlib";

/**
 * Loads a static (non-animated) CC0 furniture FBX and clones it per
 * instance - `useLoader` caches the parsed FBX by URL, so a desk used by
 * 23 agents is only fetched/parsed once; every <Desk /> on screen just
 * clones that one parsed scene graph (materials/geometry stay shared,
 * three.js's own Object3D.clone() handles this correctly for non-skinned
 * meshes - SkeletonUtils is only needed for the rigged characters).
 */
export function FBXModel({
  url,
  scale = 0.011,
  position,
  rotation,
}: {
  url: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const fbx = useLoader(FBXLoader, url);
  const clone = useMemo(() => {
    const c = fbx.clone(true);
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [fbx]);

  return <primitive object={clone} scale={scale} position={position} rotation={rotation} />;
}
