import * as THREE from "three";

/**
 * Single open-plan office building, adapted (MIT) from yugienugraha/ruang's
 * src/office3d-layout.ts. The building shape, meeting room, lounge, pantry
 * and game room all keep ruang's original coordinates and proportions.
 *
 * The ONE thing this version changes from the original: desks are not flat
 * hot-desking. They are grouped into contiguous per-division blocks within
 * the same two-row desk grid, so the office reads as "Software's corner,
 * Konten's corner, ..." instead of one undifferentiated pool.
 *
 *   z -5 ┌──────────── back wall ─────────────┬────────┬───────────┐
 *        │ desks, two rows, one contiguous    │ lounge │ game room │
 *        │ block per division, growing left   │(sofa,TV)│          │
 *        │ meeting room (table, whiteboard)   │ pantry ├───────────┘
 *   z  4 └── low front wall ── entrance ──────────────┘
 *
 * (Lantai 2 / dorm / balcony / street food from the original are not
 * ported yet - this is the ground-floor workspace only.)
 */

export type Vec3 = [number, number, number];

export interface DivisionSeed {
  slug: string;
  name: string;
  /** Agents who sit at a regular desk (the division's PM, if any, is excluded - see pmIncluded). */
  deskAgentCount: number;
  accent: string;
}

export interface DeskSlot {
  position: Vec3;
  seat: Vec3;
  facing: number;
  divisionSlug: string;
}

export interface DivisionZone {
  slug: string;
  name: string;
  accent: string;
  minX: number;
  maxX: number;
  centerX: number;
  deskCount: number;
}

export interface MeetingSeatSlot {
  position: Vec3;
  facing: number;
  seated: boolean;
}

export interface OfficeLayout {
  deskCount: number;
  building: { minX: number; maxX: number; minZ: number; maxZ: number };
  desks: DeskSlot[];
  zones: DivisionZone[];
  meetingRoom: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    table: { x1: number; x2: number; z: number };
    whiteboard: Vec3;
    /** One seat per division PM (first seat is nearest the whiteboard, "presenting"). */
    seats: MeetingSeatSlot[];
  };
  lounge: { sofa: Vec3; coffeeTable: Vec3; tv: Vec3; seats: Vec3[]; rug: { x: number; z: number; w: number; d: number } };
  pantry: { counter: Vec3; rotation: number };
  gameRoom: { minX: number; maxX: number; minZ: number; maxZ: number; table: Vec3 };
  camera: { target: Vec3; offset: Vec3 };
  pan: { minX: number; maxX: number; minZ: number; maxZ: number };
}

// --- Constants carried over verbatim from ruang's office3d-layout.ts -------
const DESK_RIGHT_X = -2;
const DESK_PITCH = 2.6;
const DESK_ROWS_Z = [-3.5, -1] as const;
const MIN_DESK_COLUMNS = 3;
const BASE_MIN_X = -9.5;
const BASE_SCENE_WIDTH = 28.7;
const CAMERA_OFFSET_BASE: Vec3 = [-3.9, 15.2, 18.8];

const MEETING_ROOM_MAX_X = -3.2;
const MEETING_ROOM_MIN_Z = 0.95;
const MEETING_TABLE_Z = 2.75;
const MEETING_SEAT_PITCH = 0.8;
const WHITEBOARD_X = -3.75;

const GAME_ROOM = { minX: 9.5, maxX: 15.5, minZ: -5.2, maxZ: 0.6 };
const TV: Vec3 = [4.6, 0, -4.8];
const SOFA: Vec3 = [4.6, 0, -1.3];
const COFFEE_TABLE: Vec3 = [4.6, 0, -2.9];
const LOUNGE_SEATS: Vec3[] = [
  [4, 0, -1.8],
  [2.5, 0, -2.9],
  [6.7, 0, -2.9],
];
const PANTRY: Vec3 = [8.8, 0, 2.2];

/** Build the office for the given divisions, in order - desks group by division, not globally. */
export function createOfficeLayout(divisions: DivisionSeed[]): OfficeLayout {
  const deskCount = Math.max(1, divisions.reduce((sum, d) => sum + d.deskAgentCount, 0));

  // Column pairs (one per column, two seats per column - back row then front row) are
  // allocated to each division in turn, so a division's desks sit next to each other.
  let columnCursor = 0;
  const desks: DeskSlot[] = [];
  const zones: DivisionZone[] = [];
  for (const division of divisions) {
    const count = Math.max(0, division.deskAgentCount);
    if (count === 0) {
      zones.push({ slug: division.slug, name: division.name, accent: division.accent, minX: 0, maxX: 0, centerX: 0, deskCount: 0 });
      continue;
    }
    const columnsNeeded = Math.ceil(count / 2);
    const firstColumn = columnCursor;
    let placed = 0;
    for (let c = 0; c < columnsNeeded && placed < count; c += 1) {
      const column = firstColumn + c;
      const x = DESK_RIGHT_X - column * DESK_PITCH;
      for (let row = 0; row < DESK_ROWS_Z.length && placed < count; row += 1) {
        const z = DESK_ROWS_Z[row];
        desks.push({
          position: [x, 0, z],
          seat: [x, 0, z - 0.75],
          facing: 0,
          divisionSlug: division.slug,
        });
        placed += 1;
      }
    }
    columnCursor += columnsNeeded;
    const lastX = DESK_RIGHT_X - (columnCursor - 1) * DESK_PITCH;
    const firstX = DESK_RIGHT_X - firstColumn * DESK_PITCH;
    zones.push({
      slug: division.slug,
      name: division.name,
      accent: division.accent,
      minX: lastX - DESK_PITCH / 2,
      maxX: firstX + DESK_PITCH / 2,
      centerX: (lastX + firstX) / 2,
      deskCount: count,
    });
  }

  const totalColumns = Math.max(MIN_DESK_COLUMNS, columnCursor);
  const minX = DESK_RIGHT_X - (totalColumns - 1) * DESK_PITCH - 2.3;
  const shift = minX - BASE_MIN_X;
  const building = { minX, maxX: GAME_ROOM.minX, minZ: -5.2, maxZ: 4.2 };

  const sceneMinX = minX - 3.7;
  const scale = (GAME_ROOM.maxX - sceneMinX) / BASE_SCENE_WIDTH;

  // One meeting-table seat per division that has a PM (plus the presenter slot at the whiteboard).
  const pairs = Math.max(3, Math.ceil(Math.max(1, divisions.length) / 1));
  const x2 = -4.7;
  const x1 = Math.max(building.minX + 1.6, x2 - (pairs * MEETING_SEAT_PITCH + 0.5));
  const table = { x1, x2, z: MEETING_TABLE_Z };
  const meetingMinX = Math.max(building.minX, x1 - 1.4);
  const columns: number[] = [];
  for (let x = table.x2 - 0.45; x >= table.x1 + 0.35; x -= MEETING_SEAT_PITCH) columns.push(x);
  const seats: MeetingSeatSlot[] = columns.flatMap((x): MeetingSeatSlot[] => [
    { position: [x, 0, table.z - 0.7], facing: 0, seated: true },
    { position: [x, 0, table.z + 0.7], facing: Math.PI, seated: true },
  ]);

  void shift;
  return {
    deskCount,
    building,
    desks,
    zones,
    meetingRoom: {
      minX: meetingMinX,
      maxX: MEETING_ROOM_MAX_X,
      minZ: MEETING_ROOM_MIN_Z,
      maxZ: building.maxZ,
      table,
      whiteboard: [WHITEBOARD_X, 0, MEETING_TABLE_Z],
      seats,
    },
    lounge: { sofa: SOFA, coffeeTable: COFFEE_TABLE, tv: TV, seats: LOUNGE_SEATS, rug: { x: 4.6, z: -2.9, w: 4.4, d: 2.8 } },
    pantry: { counter: PANTRY, rotation: -Math.PI / 2 },
    gameRoom: {
      ...GAME_ROOM,
      table: [(GAME_ROOM.minX + GAME_ROOM.maxX) / 2, 0, (GAME_ROOM.minZ + GAME_ROOM.maxZ) / 2] as Vec3,
    },
    camera: {
      target: [(sceneMinX + GAME_ROOM.maxX) / 2 - 0.15, 0.6, 0.2],
      offset: CAMERA_OFFSET_BASE.map((v) => v * scale) as Vec3,
    },
    pan: { minX: sceneMinX - 0.3, maxX: 17, minZ: -7, maxZ: 11 },
  };
}

/** Deterministic pseudo-random offset within a disc, from a seed (used for idle jitter). */
export function jitterDisc(seed: number, radius: number): [number, number] {
  const a = (seed % 360) * (Math.PI / 180);
  const r = radius * (0.35 + (0.65 * (((seed * 2654435761) >>> 0) % 1000)) / 1000);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function vec3(v: Vec3) {
  return new THREE.Vector3(v[0], v[1], v[2]);
}
