import * as THREE from "three";

/**
 * Procedural canvas textures, so the 3D office ships without any image
 * files. Adapted (MIT) from yugienugraha/ruang's scene3d/textures.ts.
 */

const cache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  repeat?: [number, number]
): THREE.Texture {
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  cache.set(key, texture);
  return texture;
}

/** Deterministic pseudo-random numbers so textures look the same on every load. */
function random(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/** Warm parquet planks. */
export function woodFloor(repeat: [number, number]) {
  return canvasTexture(
    `wood-${repeat.join("x")}`,
    512,
    512,
    (ctx) => {
      const rand = random(7);
      const tones = ["#b98355", "#a9744a", "#c48f5f", "#b07b4f", "#9f6c43"];
      const plankH = 64;
      for (let row = 0; row < 512 / plankH; row += 1) {
        let x = row % 2 === 0 ? 0 : -96;
        while (x < 512) {
          const width = 128 + Math.floor(rand() * 96);
          ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
          ctx.fillRect(x, row * plankH, width, plankH);
          ctx.strokeStyle = "rgba(60,35,20,0.18)";
          for (let grain = 0; grain < 5; grain += 1) {
            const y = row * plankH + 8 + rand() * (plankH - 16);
            ctx.beginPath();
            ctx.moveTo(x + 4, y);
            ctx.bezierCurveTo(x + width / 3, y + 3, x + (2 * width) / 3, y - 3, x + width - 4, y);
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(50,28,15,0.55)";
          ctx.fillRect(x, row * plankH, 2, plankH);
          x += width;
        }
        ctx.fillStyle = "rgba(50,28,15,0.5)";
        ctx.fillRect(0, row * plankH, 512, 2);
      }
    },
    repeat
  );
}

/** Light ceramic tiles for the pantry. */
export function tileFloor(repeat: [number, number]) {
  return canvasTexture(
    `tile-${repeat.join("x")}`,
    256,
    256,
    (ctx) => {
      ctx.fillStyle = "#e9e4da";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "#d6cfc2";
      for (let i = 0; i <= 256; i += 64) {
        ctx.fillRect(i - 1, 0, 2, 256);
        ctx.fillRect(0, i - 1, 256, 2);
      }
    },
    repeat
  );
}

export function carpet(color: string, repeat: [number, number]) {
  return canvasTexture(
    `carpet-${color}-${repeat.join("x")}`,
    128,
    128,
    (ctx) => {
      const rand = random(11);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i += 1) {
        ctx.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
        ctx.fillRect(rand() * 128, rand() * 128, 1, 1);
      }
    },
    repeat
  );
}

export function screenTexture(active: boolean) {
  return canvasTexture(`screen-${active}`, 128, 80, (ctx) => {
    ctx.fillStyle = active ? "#15313a" : "#0d1112";
    ctx.fillRect(0, 0, 128, 80);
    if (!active) return;
    const rand = random(13);
    for (let line = 0; line < 9; line += 1) {
      ctx.fillStyle = ["#7ee0c3", "#f2c58a", "#a9d4ff", "#e7e7e7"][line % 4];
      ctx.fillRect(8 + (line % 3) * 6, 8 + line * 7.5, 30 + rand() * 70, 3);
    }
  });
}
