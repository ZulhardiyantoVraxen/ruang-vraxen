"use client";

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

/**
 * Loads a static (non-animated) CC0 furniture model and clones it per
 * instance. Kenney's Furniture Kit ships ASCII FBX, which three-stdlib's
 * FBXLoader fails to parse ("Cannot read properties of undefined (reading
 * 'a')" on every file in the pack - a parser bug, not a per-file issue),
 * so these are pre-converted to .glb (via assimp) and loaded with the far
 * more robust GLTFLoader instead. `useLoader` caches the parsed glTF by
 * URL, so a desk used by 23 agents is only fetched/parsed once.
 */
export function GLBModel({
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
  const gltf = useLoader(GLTFLoader, url);
  const clone = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [gltf]);

  return <primitive object={clone} scale={scale} position={position} rotation={rotation} />;
}
