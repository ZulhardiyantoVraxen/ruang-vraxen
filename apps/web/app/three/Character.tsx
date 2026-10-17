"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { FBXLoader, SkeletonUtils } from "three-stdlib";

/**
 * Animated low-poly office workers, loaded from Quaternius's CC0
 * "Animated Men/Women Characters" FBX pack (public/models/characters -
 * see public/models/CREDITS.md). Each FBX bundles one rigged character
 * plus Idle/Walk/Sitting/Run animation clips on the same skeleton.
 *
 * `useLoader` parses each of the 6 outfit files once and caches by URL -
 * every on-screen agent just clones that one parsed skeleton via
 * SkeletonUtils.clone (the three.js-blessed way to reuse a rig across
 * many instances; a plain Object3D.clone() does not correctly rebind
 * bone references for a SkinnedMesh) and drives its own AnimationMixer,
 * so 23 agents share 6 network fetches, not 23.
 */

export type Pose = "walk" | "sit" | "stand";

const CHARACTER_MODELS = [
  "/models/characters/Male_Casual.fbx",
  "/models/characters/Male_Shirt.fbx",
  "/models/characters/Male_Suit.fbx",
  "/models/characters/Female_Casual.fbx",
  "/models/characters/Female_TankTop.fbx",
  "/models/characters/Female_Dress.fbx",
];

// Quaternius exports these rigs at roughly centimeter scale (character
// ends up ~170-180 units tall) - scale down to a ~1.75m-tall person.
const SCALE = 0.0105;

export function characterModelFor(seed: number) {
  return CHARACTER_MODELS[seed % CHARACTER_MODELS.length];
}

function pickClip(animations: THREE.AnimationClip[], want: "idle" | "walk" | "sit") {
  const matchers: Record<typeof want, RegExp> = {
    idle: /idle/i,
    walk: /walk/i,
    sit: /sit/i,
  } as const;
  return animations.find((c) => matchers[want].test(c.name));
}

export function Character({
  pose,
  active,
  seed = 0,
}: {
  accent?: string;
  pose: Pose;
  /** true while sitting-and-typing or standing-and-chatting - reserved for a future subtle layered motion */
  active?: boolean;
  seed?: number;
}) {
  const url = characterModelFor(seed);
  const fbx = useLoader(FBXLoader, url);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<"idle" | "walk" | "sit", THREE.AnimationAction>>>({});
  const currentKeyRef = useRef<"idle" | "walk" | "sit" | null>(null);

  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(fbx) as THREE.Group;
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return c;
  }, [fbx]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clone);
    mixerRef.current = mixer;
    const actions: typeof actionsRef.current = {};
    (["idle", "walk", "sit"] as const).forEach((key) => {
      const clip = pickClip(fbx.animations, key);
      if (clip) {
        const action = mixer.clipAction(clip, clone);
        if (key === "sit") {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions[key] = action;
      }
    });
    actionsRef.current = actions;
    currentKeyRef.current = null;
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [clone, fbx]);

  useEffect(() => {
    const key = pose === "walk" ? "walk" : pose === "sit" ? "sit" : "idle";
    if (currentKeyRef.current === key) return;
    const prevKey = currentKeyRef.current;
    const next = actionsRef.current[key];
    const prev = prevKey ? actionsRef.current[prevKey] : null;
    if (next) {
      next.reset().fadeIn(0.25).play();
    }
    if (prev && prev !== next) {
      prev.fadeOut(0.25);
    }
    currentKeyRef.current = key;
  }, [pose]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  return <primitive object={clone} scale={SCALE} />;
}
