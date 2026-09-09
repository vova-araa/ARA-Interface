import {
  axialToWorld,
  placementForProject,
  ventureForProject,
  VENTURES,
  type ProjectPlacement,
  type SessionState,
  type VentureStyle,
  type WorldConfig,
} from '@ara/shared';

export const HEX_SPACING = 1.06; // gap between tiles

const projectCache = new Map<string, ProjectPlacement>();
let cachedConfig: WorldConfig | null = null;

export function projectPlacement(config: WorldConfig, project: string): ProjectPlacement {
  if (cachedConfig !== config) {
    projectCache.clear();
    cachedConfig = config;
  }
  let placement = projectCache.get(project);
  if (!placement) {
    placement = placementForProject(config, project);
    projectCache.set(project, placement);
  }
  return placement;
}

export function ventureOf(config: WorldConfig, project: string): VentureStyle {
  const placement = projectPlacement(config, project);
  return VENTURES.find((v) => v.id === placement.venture) ?? ventureForProject(project);
}

/**
 * Where a session's pod stands: sessions of one project occupy the cluster's
 * hexes (center first), deterministically by sessionId hash order.
 */
export function sessionPosition(
  config: WorldConfig,
  session: SessionState,
  indexInProject: number,
): { x: number; z: number } {
  const placement = projectPlacement(config, session.project);
  const hex = placement.hexes[indexInProject % placement.hexes.length] ?? placement.center;
  const { x, z } = axialToWorld(hex);
  return { x: x * HEX_SPACING, z: z * HEX_SPACING };
}

export function districtEdge(config: WorldConfig, project: string): { x: number; z: number } {
  const placement = projectPlacement(config, project);
  const { x, z } = axialToWorld(placement.center);
  // Walk-in start: push outward from the hub along the district direction.
  const len = Math.hypot(x, z) || 1;
  return { x: (x + (x / len) * 4) * HEX_SPACING, z: (z + (z / len) * 4) * HEX_SPACING };
}
