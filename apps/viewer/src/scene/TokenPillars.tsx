import { useEffect, useState } from 'react';
import type { WorldConfig } from '@ara/shared';
import { loadUsage, type UsageRow } from '../api.ts';
import { useAra } from '../store.ts';
import { projectPlacement } from '../placements.ts';
import { axialToWorld } from '@ara/shared';
import { HEX_SPACING } from '../placements.ts';

/**
 * Token-verbruik per project als gouden muntstapel naast het cluster.
 * Hoogte is logaritmisch: 1 munt ≈ 1k, 8 munten ≈ 10M+ tokens vandaag.
 */
function coinsFor(tokens: number): number {
  if (tokens <= 0) return 0;
  return Math.max(1, Math.min(8, Math.round(Math.log10(tokens) * 1.6 - 3)));
}

export function TokenPillars({ world }: { world: WorldConfig }): JSX.Element | null {
  const demo = useAra((s) => s.demo);
  const [rows, setRows] = useState<UsageRow[]>([]);

  useEffect(() => {
    if (demo) return;
    const refresh = (): void => void loadUsage().then((res) => setRows(res.usage));
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [demo]);

  if (demo || rows.length === 0) return null;

  return (
    <group>
      {rows.map((row) => {
        const coins = coinsFor(row.inputTokens + row.outputTokens);
        if (coins === 0) return null;
        const placement = projectPlacement(world, row.project);
        const { x, z } = axialToWorld(placement.center);
        const hasErrors = false;
        return (
          <group key={row.project} position={[x * HEX_SPACING + 0.62, 0.3, z * HEX_SPACING + 0.62]}>
            {Array.from({ length: coins }, (_, i) => (
              <mesh key={i} position={[0, i * 0.075, 0]} castShadow>
                <cylinderGeometry args={[0.14, 0.14, 0.06, 12]} />
                <meshStandardMaterial
                  color={hasErrors ? '#c9a86a' : '#e6b800'}
                  metalness={0.7}
                  roughness={0.3}
                  emissive="#e6b800"
                  emissiveIntensity={0.12}
                />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}
