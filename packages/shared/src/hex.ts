/**
 * Axial hex-grid math (pointy-top) + deterministic placement.
 * Positions are derived from stable hashes so the world never re-shuffles.
 */

export interface Axial {
  q: number;
  r: number;
}

export const HEX_SIZE = 1; // world units, viewer scales

export function axialToWorld({ q, r }: Axial, size = HEX_SIZE): { x: number; z: number } {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const z = size * 1.5 * r;
  return { x, z };
}

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

const AXIAL_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function axialAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function axialScale(a: Axial, k: number): Axial {
  return { q: a.q * k, r: a.r * k };
}

/** Ring of hexes at a given radius around a center. Radius 0 → [center]. */
export function hexRing(center: Axial, radius: number): Axial[] {
  if (radius === 0) return [center];
  const results: Axial[] = [];
  let hex = axialAdd(center, axialScale(AXIAL_DIRS[4]!, radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(hex);
      hex = axialAdd(hex, AXIAL_DIRS[side]!);
    }
  }
  return results;
}

/** Filled hex disc (spiral order) of a given radius around a center. */
export function hexDisc(center: Axial, radius: number): Axial[] {
  const out: Axial[] = [];
  for (let r = 0; r <= radius; r++) out.push(...hexRing(center, r));
  return out;
}

/** FNV-1a — stable across platforms, good enough for placement. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministically pick the n-th free hex for `name`, spiraling outward from
 * `center`, skipping hexes already in `taken` (keys via axialKey).
 */
export function placeOnFreeHex(
  name: string,
  center: Axial,
  taken: Set<string>,
  maxRadius = 64,
): Axial {
  const hash = stableHash(name);
  for (let radius = 0; radius <= maxRadius; radius++) {
    const ring = hexRing(center, radius);
    // Rotate the ring by the hash so different names prefer different slots.
    const offset = ring.length > 0 ? hash % ring.length : 0;
    for (let i = 0; i < ring.length; i++) {
      const hex = ring[(i + offset) % ring.length]!;
      if (!taken.has(axialKey(hex))) {
        taken.add(axialKey(hex));
        return hex;
      }
    }
  }
  // World is full — stack at center rather than crash.
  return center;
}
