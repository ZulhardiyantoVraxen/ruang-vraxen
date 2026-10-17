import * as THREE from "three";

export const ROOM_W = 5;
export const ROOM_D = 4;
export const GAP = 1.1;

export type RoomRect = { x: number; z: number; w: number; d: number };

const COL_L = -(ROOM_W / 2 + GAP / 2);
const COL_R = ROOM_W / 2 + GAP / 2;
const ROW_PUSAT = 0;
const ROW_MID = ROOM_D + GAP;
const ROW_BOTTOM = (ROOM_D + GAP) * 2;
export const ROW_LOUNGE = (ROOM_D + GAP) * 3;

export const ROOM_LAYOUT: Record<string, RoomRect> = {
  pusat: { x: 0, z: ROW_PUSAT, w: ROOM_W, d: ROOM_D },
  software: { x: COL_L, z: ROW_MID, w: ROOM_W, d: ROOM_D },
  konten: { x: COL_R, z: ROW_MID, w: ROOM_W, d: ROOM_D },
  konstruksi: { x: COL_L, z: ROW_BOTTOM, w: ROOM_W, d: ROOM_D },
  kesehatan: { x: COL_R, z: ROW_BOTTOM, w: ROOM_W, d: ROOM_D },
};

const EXTRA_COLS = [COL_L, COL_R];

export function layoutFor(slugs: string[]) {
  const rects: Record<string, RoomRect> = { ...ROOM_LAYOUT };
  const extras = slugs.filter((s) => !ROOM_LAYOUT[s]);
  let row = 0;
  extras.forEach((slug, i) => {
    const col = i % 2;
    if (i > 0 && col === 0) row += 1;
    rects[slug] = { x: EXTRA_COLS[col], z: ROW_BOTTOM + (row + 1) * (ROOM_D + GAP), w: ROOM_W, d: ROOM_D };
  });
  return rects;
}

/**
 * One desk+chair slot per agent, spaced along the room's back wall.
 * `rowOffsetZ` pushes a whole row deeper into the room (toward the
 * entrance) without touching the first row - used to give the "Pusat"
 * room a second row of desks for visiting PMs (see commandSeatsFor in
 * OfficeScene3D.tsx), so a command desk never overlaps Pusat's own staff row.
 */
export function deskSlots(room: RoomRect, count: number, rowOffsetZ = 0) {
  const n = Math.max(count, 1);
  const spacing = room.w / (n + 1);
  const wallZ = room.z - room.d / 2 + 0.55 + rowOffsetZ;
  const seatZ = wallZ + 0.65;
  const slots: { desk: THREE.Vector3; seat: THREE.Vector3; facing: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = room.x - room.w / 2 + spacing * (i + 1);
    slots.push({
      desk: new THREE.Vector3(x, 0, wallZ),
      seat: new THREE.Vector3(x, 0, seatZ),
      facing: Math.PI,
    });
  }
  return slots;
}

/** How far into the room the second ("command") desk row sits. */
export const COMMAND_ROW_OFFSET = 1.55;

/**
 * One ANCHOR per idle activity, not a fixed pool of seats - the office can
 * realistically have every agent idle at once (e.g. a freshly seeded org
 * with no tasks assigned yet), and there are far more agents than literal
 * chairs. Each idle agent gets a deterministic jittered offset around its
 * category's anchor (see idleSpotFor below) so a crowd reads as "gathered
 * around the sofa / game table" rather than everyone stacked on one point.
 * Radii are generous on purpose - a tight jitter reads as "huddled in a
 * clump" the moment more than two or three agents land on the same anchor,
 * and "stroll" in particular spreads across most of the open lounge floor
 * rather than one corner of it. A separate "desk" idle category (see
 * OfficeScene3D.tsx) keeps some idle agents at their own desk instead of
 * sending everyone to the lounge at once, which is the other half of
 * looking natural rather than grouped.
 */
export function loungeAnchors(centerX: number) {
  return {
    sofa: { pos: new THREE.Vector3(centerX - 1.2, 0, ROW_LOUNGE - 0.15), facing: 0, kind: "sit" as const, radius: 0.75 },
    game: { pos: new THREE.Vector3(centerX + 0.75, 0, ROW_LOUNGE), facing: Math.PI / 2, kind: "sit" as const, radius: 0.8 },
    pantry: { pos: new THREE.Vector3(centerX + 2.6, 0, ROW_LOUNGE - 0.6), facing: Math.PI, kind: "stand" as const, radius: 0.8 },
    stroll: { pos: new THREE.Vector3(centerX - 2.3, 0, ROW_LOUNGE + 1.0), facing: 0, kind: "stand" as const, radius: 2.1 },
  };
}

/** Deterministic pseudo-random offset within a disc, from a seed. */
export function jitterDisc(seed: number, radius: number): [number, number] {
  const a = (seed % 360) * (Math.PI / 180);
  const r = radius * (0.35 + 0.65 * (((seed * 2654435761) >>> 0) % 1000) / 1000);
  return [Math.cos(a) * r, Math.sin(a) * r];
}
