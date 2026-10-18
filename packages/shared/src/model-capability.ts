/**
 * "Tambahkan otomatis model gratisnya berdasarkan peran si agen" - the flat
 * per-Tingkat pool in model-routing.ts spreads load across every free model
 * in a Tingkat, but a Developer and a Riset & Script agent don't actually
 * need the same kind of free model. This file infers a rough capability tag
 * for both sides - the model (from its OpenRouter slug alone) and the role
 * (from its name + responsibilities text) - with no manual tagging table to
 * maintain: add a new free model to a pool or a new role to the org chart
 * and it slots into a category automatically.
 */
export type ModelCapabilityTag = "CODE" | "REASONING" | "VISION" | "GENERAL";

const CODE_SLUG_HINTS = ["code", "coder"];
const REASONING_SLUG_HINTS = ["reasoning", "-r1", "think"];
const VISION_SLUG_HINTS = ["vision", "-vl", "omni", "clip", "lyria"];

/** Tags a free OpenRouter model slug by the hints in its own id - deliberately simple so it never needs a lookup table that can drift out of date. */
export function tagFreeModel(slug: string): ModelCapabilityTag[] {
  const s = slug.toLowerCase();
  const tags: ModelCapabilityTag[] = [];
  if (CODE_SLUG_HINTS.some((h) => s.includes(h))) tags.push("CODE");
  if (REASONING_SLUG_HINTS.some((h) => s.includes(h))) tags.push("REASONING");
  if (VISION_SLUG_HINTS.some((h) => s.includes(h))) tags.push("VISION");
  return tags.length > 0 ? tags : ["GENERAL"];
}

const CODE_ROLE_HINTS = [
  "developer",
  "devops",
  "qa",
  "reviewer",
  "program",
  "kode",
  "code",
  "billing",
  "klaim",
  "kepatuhan data",
  "estimator",
  "hitung",
  "rab",
  "finance",
  "invoice",
  "tender",
  "pengadaan",
];
const VISION_ROLE_HINTS = ["desain", "visual", "ui/ux", "ui ", "ux", "gambar", "video", "image", "vision"];
const REASONING_ROLE_HINTS = ["analis", "audit", "strategi", "arsitektur", "chief of staff"];

/** Infers which capability a role most needs from its name + responsibilities, so the pool narrows per role without the director tagging anything by hand. */
export function inferRoleCapability(roleName: string, responsibilities?: string | null): ModelCapabilityTag {
  const text = `${roleName} ${responsibilities ?? ""}`.toLowerCase();
  if (VISION_ROLE_HINTS.some((h) => text.includes(h))) return "VISION";
  if (CODE_ROLE_HINTS.some((h) => text.includes(h))) return "CODE";
  if (REASONING_ROLE_HINTS.some((h) => text.includes(h))) return "REASONING";
  return "GENERAL";
}
