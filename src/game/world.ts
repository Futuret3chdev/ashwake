export const WORLD_R = 520;

export const LAKES = [
  { x: 150, z: -80, r: 48 },
  { x: -250, z: 170, r: 40 },
  { x: 60, z: 340, r: 32 },
] as const;

export const GROVE = { x: -190, z: -230, r: 36 };

export function terrainHeight(x: number, z: number) {
  return (
    Math.sin(x * 0.02) * 7 +
    Math.cos(z * 0.016) * 5 +
    Math.sin((x + z) * 0.007) * 4.5 +
    Math.sin(x * 0.041 + z * 0.03) * 1.2
  );
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function approachAngle(cur: number, target: number, maxStep: number) {
  const d = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  if (Math.abs(d) <= maxStep) return cur + d;
  return cur + Math.sign(d) * maxStep;
}

export function yawToward(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}

export function forwardOf(yaw: number) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}


export type Biome = "verdant" | "steppe" | "ash" | "magma";

export function biomeOf(heat: number): Biome {
  if (heat < 28) return "verdant";
  if (heat < 52) return "steppe";
  if (heat < 76) return "ash";
  return "magma";
}

export const BIOME_LABEL: Record<Biome, string> = {
  verdant: "Verdant",
  steppe: "Steppe",
  ash: "Ash",
  magma: "Magma",
};
