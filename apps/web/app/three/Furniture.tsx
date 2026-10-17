"use client";

/**
 * Office furniture, loaded from the CC0 Kenney "Furniture Pack" models in
 * public/models/furniture (see public/models/CREDITS.md). The pack ships
 * ASCII FBX, which three-stdlib's FBXLoader cannot parse (a parser bug
 * that hits every file in the pack identically), so each piece was
 * pre-converted to .glb with assimp and is loaded here via GLTFLoader.
 * The whiteboard has no equivalent in that pack, so it stays a simple
 * primitive-built box - the only piece in this file that isn't a loaded
 * model.
 */

import { GLBModel } from "./GLBModel";

export function Desk() {
  return <GLBModel url="/models/furniture/desk.glb" scale={0.16} />;
}

export function Monitor() {
  return (
    <group>
      <GLBModel url="/models/furniture/computerScreen.glb" scale={0.15} />
      <GLBModel url="/models/furniture/computerKeyboard.glb" scale={0.15} />
    </group>
  );
}

export function Chair() {
  return <GLBModel url="/models/furniture/chairDesk.glb" scale={0.15} />;
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
  return <GLBModel url="/models/furniture/pottedPlant.glb" scale={0.17} />;
}

export function SmallPlant() {
  return <GLBModel url="/models/furniture/plantSmall1.glb" scale={0.25} />;
}

export function Sofa() {
  return <GLBModel url="/models/furniture/loungeSofaLong.glb" scale={0.18} />;
}

export function GameTable() {
  return (
    <group>
      <GLBModel url="/models/furniture/tableCoffee.glb" scale={0.15} />
      <GLBModel url="/models/furniture/stoolBar.glb" scale={0.16} position={[0.5, 0, 0.5]} />
      <GLBModel url="/models/furniture/stoolBar.glb" scale={0.16} position={[-0.5, 0, -0.5]} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

export function PantryCounter() {
  return (
    <group>
      <GLBModel url="/models/furniture/kitchenBar.glb" scale={0.2} />
      <GLBModel url="/models/furniture/kitchenCoffeeMachine.glb" scale={0.2} position={[0.3, 0.75, -0.1]} />
      <GLBModel url="/models/furniture/kitchenFridgeSmall.glb" scale={0.14} position={[-1.1, 0, -0.2]} />
    </group>
  );
}

export function Bookcase() {
  return <GLBModel url="/models/furniture/bookcaseOpen.glb" scale={0.2} />;
}

export function Trashcan() {
  return <GLBModel url="/models/furniture/trashcan.glb" scale={0.09} />;
}
