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

/** One desk+chair slot per agent, spaced along the room's back wall. */
export function deskSlots(room: RoomRect, count: number) {
  const n = Math.max(count, 1);
  const spacing = room.w / (n + 1);
  const wallZ = room.z - room.d / 2 + 0.55;
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

/** Fixed, hand-placed spots in the shared lounge/break area. */
export function loungeSpots(centerX: number) {
  return {
    sofa: [
      { pos: new THREE.Vector3(centerX - 1.55, 0, ROW_LOUNGE - 0.15), facing: 0, kind: "sit" as const },
      { pos: new THREE.Vector3(centerX - 0.9, 0, ROW_LOUNGE - 0.15), facing: 0, kind: "sit" as const },
    ],
    game: [
      { pos: new THREE.Vector3(centerX + 0.75, 0, ROW_LOUNGE - 0.55), facing: Math.PI, kind: "sit" as const },
      { pos: new THREE.Vector3(centerX + 0.75, 0, ROW_LOUNGE + 0.55), facing: 0, kind: "sit" as const },
    ],
    pantry: [
      { pos: new THREE.Vector3(centerX + 2.45, 0, ROW_LOUNGE - 0.5), facing: Math.PI, kind: "stand" as const },
      { pos: new THREE.Vector3(centerX + 2.95, 0, ROW_LOUNGE - 0.5), facing: Math.PI, kind: "stand" as const },
    ],
    stroll: [
      { pos: new THREE.Vector3(centerX - 2.4, 0, ROW_LOUNGE + 0.8), facing: 0.6, kind: "stand" as const },
      { pos: new THREE.Vector3(centerX + 0.2, 0, ROW_LOUNGE + 1.3), facing: -0.4, kind: "stand" as const },
    ],
  };
}
