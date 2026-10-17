"use client";

/**
 * Office furniture, loaded from the CC0 Kenney "Furniture Pack" FBX files
 * in public/models/furniture (see public/models/CREDITS.md). The
 * whiteboard has no equivalent in that pack, so it stays a simple
 * primitive-built box - the only piece in this file that isn't a loaded
 * model.
 */

import { FBXModel } from "./FBXModel";

export function Desk() {
  return <FBXModel url="/models/furniture/desk.fbx" />;
}

export function Monitor() {
  return (
    <group>
      <FBXModel url="/models/furniture/computerScreen.fbx" />
      <FBXModel url="/models/furniture/computerKeyboard.fbx" />
    </group>
  );
}

export function Chair() {
  return <FBXModel url="/models/furniture/chairDesk.fbx" />;
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
  return <FBXModel url="/models/furniture/pottedPlant.fbx" />;
}

export function SmallPlant() {
  return <FBXModel url="/models/furniture/plantSmall1.fbx" />;
}

export function Sofa() {
  return <FBXModel url="/models/furniture/loungeSofaLong.fbx" />;
}

export function GameTable() {
  return (
    <group>
      <FBXModel url="/models/furniture/tableCoffee.fbx" />
      <FBXModel url="/models/furniture/stoolBar.fbx" position={[0.5, 0, 0.5]} />
      <FBXModel url="/models/furniture/stoolBar.fbx" position={[-0.5, 0, -0.5]} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

export function PantryCounter() {
  return (
    <group>
      <FBXModel url="/models/furniture/kitchenBar.fbx" />
      <FBXModel url="/models/furniture/kitchenCoffeeMachine.fbx" position={[0.3, 0.75, -0.1]} />
      <FBXModel url="/models/furniture/kitchenFridgeSmall.fbx" position={[-1.1, 0, -0.2]} />
    </group>
  );
}

export function Bookcase() {
  return <FBXModel url="/models/furniture/bookcaseOpen.fbx" />;
}

export function Trashcan() {
  return <FBXModel url="/models/furniture/trashcan.fbx" />;
}
