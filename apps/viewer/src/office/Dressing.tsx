import * as THREE from 'three';
import type { OfficeSnapshot } from '@ara/shared';

/**
 * Wat een kantoor tot díé werkvloer maakt.
 *
 * De ruimte, de bureaus en de muurschermen waren voor elke tak hetzelfde; wat
 * verschilde was de tekst erop. Dan is een garage alleen een garage omdat er
 * "wagenpark" op de muur staat. Hier staat het meubilair dat bij het vak hoort:
 * een hefbrug in de werkplaats, een koersenwand op de handelsvloer, ezels in de
 * studio, een podium bij de muziek.
 *
 * Alles is grof blokwerk met opzet — je kijkt van bovenaf onder een
 * ortho-camera, dus silhouet en kleur doen het werk, geen detail dat op die
 * afstand toch verdwijnt.
 */

const props = { castShadow: true, receiveShadow: true } as const;

function Box({
  position,
  size,
  color,
  rotation,
  emissive,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
  emissive?: string;
}): JSX.Element {
  return (
    <mesh position={position} rotation={rotation} {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={0.8}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissive ? 0.9 : 0}
      />
    </mesh>
  );
}

/** Werkplaats: hefbrug met truck erop, gereedschapswand, bandenstapels. */
function FleetBay({ x, z }: { x: number; z: number }): JSX.Element {
  return (
    <group position={[x, 0, z]}>
      {/* vloervak in signaalgeel — een werkplaats heeft belijning */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[6.4, 5]} />
        <meshStandardMaterial color="#6f6840" roughness={0.95} />
      </mesh>
      {/* hefbrug */}
      <Box position={[0, 0.35, 0]} size={[4.6, 0.7, 2.2]} color="#c9a227" />
      <Box position={[-1.6, 0.85, 0]} size={[0.5, 1, 0.5]} color="#8e7a1c" />
      <Box position={[1.6, 0.85, 0]} size={[0.5, 1, 0.5]} color="#8e7a1c" />
      {/* truck op de brug: cabine + oplegger */}
      <Box position={[-1.3, 1.85, 0]} size={[1.7, 1.3, 1.9]} color="#d8dde6" />
      <Box position={[1.1, 1.75, 0]} size={[3, 1.1, 1.8]} color="#aeb7c6" />
      {/* gereedschapswand */}
      <Box position={[0, 1.4, -2.6]} size={[5.6, 2.4, 0.2]} color="#4d4670" />
      {[-2, -0.7, 0.6, 1.9].map((tx) => (
        <Box key={tx} position={[tx, 1.9, -2.45]} size={[0.8, 0.5, 0.08]} color="#8f88c4" />
      ))}
      {/* bandenstapels */}
      {[-2.6, 2.6].map((bx) => (
        <group key={bx} position={[bx, 0, 1.9]}>
          {[0.18, 0.5, 0.82].map((by) => (
            <mesh key={by} position={[0, by, 0]} {...props}>
              <cylinderGeometry args={[0.42, 0.42, 0.3, 14]} />
              <meshStandardMaterial color="#26222e" roughness={0.95} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Ritplanning: landkaart met routepinnen en een strokenbord. */
function TmsMap({ x, z }: { x: number; z: number }): JSX.Element {
  const pins: [number, number][] = [
    [-1.6, 0.7], [-0.4, 1.3], [0.9, 0.4], [1.8, 1.1], [-1.1, -0.6], [0.3, -1.1], [1.5, -0.4],
  ];
  return (
    <group position={[x, 0, z]}>
      {/* kaarttafel: Europa als vlak met een routenet erop */}
      <Box position={[0, 0.72, 0]} size={[5, 0.12, 3.4]} color="#cfc6ea" />
      {([[-1.9, 0.9], [1.9, 0.9], [-1.9, -0.9], [1.9, -0.9]] as [number, number][]).map(([lx, lz]) => (
        <Box key={`${lx},${lz}`} position={[lx, 0.36, lz]} size={[0.14, 0.72, 0.14]} color="#6f66a8" />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.79, 0]}>
        <planeGeometry args={[4.6, 3]} />
        <meshStandardMaterial color="#7f9d78" roughness={0.9} />
      </mesh>
      {/* routepinnen: elk een rit die ergens heen moet */}
      {pins.map(([px, pz]) => (
        <group key={`${px},${pz}`} position={[px, 0.8, pz]}>
          <mesh {...props}>
            <cylinderGeometry args={[0.035, 0.035, 0.34, 6]} />
            <meshStandardMaterial color="#d9d2f0" />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshStandardMaterial color="#ff6b5e" emissive="#ff6b5e" emissiveIntensity={0.8} />
          </mesh>
        </group>
      ))}
      {/* strokenbord ernaast: de planning van vandaag */}
      <Box position={[3.6, 1.5, 0]} size={[0.16, 2.6, 3]} color="#3f3968" rotation={[0, 0, 0]} />
      {[0.8, 0.35, -0.1, -0.55, -1].map((sy, i) => (
        <Box
          key={sy}
          position={[3.5, 1.5 + sy, -0.2 + (i % 3) * 0.5]}
          size={[0.06, 0.24, 1.7]}
          color={['#6fd3a0', '#ffd75e', '#8fb9ff', '#ff9b7a', '#c9a7ff'][i]!}
        />
      ))}
    </group>
  );
}

/** Handelsvloer: koersenwand met balken die er als een grafiek bij staan. */
function TradingWall({ x, z, accent }: { x: number; z: number; accent: string }): JSX.Element {
  const bars = [0.9, 1.5, 1.1, 2.1, 1.7, 2.6, 2.2, 3, 2.4, 1.8, 2.7, 3.3];
  return (
    <group position={[x, 0, z]}>
      <Box position={[0, 2.1, -0.3]} size={[7.4, 4.2, 0.24]} color="#1d1840" />
      {bars.map((h, i) => (
        <Box
          key={i}
          position={[-3.2 + i * 0.58, 0.55 + h / 2, -0.12]}
          size={[0.4, h, 0.1]}
          color={i % 3 === 2 ? '#ff6b5e' : '#6fd3a0'}
          emissive={i % 3 === 2 ? '#ff6b5e' : '#6fd3a0'}
        />
      ))}
      {/* tickerband onderlangs */}
      <Box position={[0, 0.34, -0.1]} size={[7.4, 0.3, 0.12]} color={accent} emissive={accent} />
    </group>
  );
}

/** Studio: ezels met doeken en een kleurenwand. */
function DesignCorner({ x, z }: { x: number; z: number }): JSX.Element {
  const swatches = ['#ff6b5e', '#ffd75e', '#6fd3a0', '#8fb9ff', '#c9a7ff', '#ff9b7a'];
  return (
    <group position={[x, 0, z]}>
      {[-1.8, 0, 1.8].map((ex, i) => (
        <group key={ex} position={[ex, 0, 0]} rotation={[0, i * 0.3 - 0.3, 0]}>
          <Box position={[0, 0.7, 0.3]} size={[0.1, 1.4, 0.1]} color="#8a6a45" />
          <Box position={[-0.4, 0.5, -0.1]} size={[0.09, 1, 0.09]} color="#8a6a45" />
          <Box position={[0.4, 0.5, -0.1]} size={[0.09, 1, 0.09]} color="#8a6a45" />
          <Box
            position={[0, 1.5, 0.22]}
            size={[1.2, 0.9, 0.06]}
            rotation={[-0.12, 0, 0]}
            color={swatches[i % swatches.length]!}
          />
        </group>
      ))}
      {/* kleurenwand */}
      <Box position={[0, 2.2, -1.6]} size={[4.4, 2.4, 0.16]} color="#463e74" />
      {swatches.map((c, i) => (
        <Box
          key={c}
          position={[-1.7 + (i % 3) * 1.15, 2.7 - Math.floor(i / 3) * 0.9, -1.48]}
          size={[0.95, 0.72, 0.06]}
          color={c}
        />
      ))}
    </group>
  );
}

/** Opnamestudio: glazen cabine, monitors, microfoon. */
function StudioBooth({ x, z }: { x: number; z: number }): JSX.Element {
  return (
    <group position={[x, 0, z]}>
      {/* cabinevloer */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <planeGeometry args={[4.6, 4]} />
        <meshStandardMaterial color="#5a4a7c" roughness={0.95} />
      </mesh>
      {/* glas: twee wanden, doorzichtig zodat je ziet wie erin staat */}
      <mesh position={[0, 1.5, 2]} {...props}>
        <boxGeometry args={[4.6, 3, 0.1]} />
        <meshStandardMaterial color="#bcd7ff" transparent opacity={0.28} roughness={0.1} />
      </mesh>
      <mesh position={[2.3, 1.5, 0]} {...props}>
        <boxGeometry args={[0.1, 3, 4]} />
        <meshStandardMaterial color="#bcd7ff" transparent opacity={0.28} roughness={0.1} />
      </mesh>
      {/* akoestische panelen tegen de achterwand */}
      {[-1.5, -0.5, 0.5, 1.5].map((px) => (
        <Box key={px} position={[px, 1.6, -1.9]} size={[0.85, 1.7, 0.16]} color="#3d3568" />
      ))}
      {/* microfoon op statief */}
      <Box position={[0, 0.75, 0]} size={[0.08, 1.5, 0.08]} color="#2a2444" />
      <mesh position={[0, 1.62, 0.1]} {...props}>
        <capsuleGeometry args={[0.11, 0.2, 4, 8]} />
        <meshStandardMaterial color="#e8e3f5" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* opnamelamp */}
      <Box position={[0, 2.9, -1.9]} size={[1.1, 0.34, 0.14]} color="#ff4a4a" emissive="#ff4a4a" />
    </group>
  );
}

/** Muziek: podium met speakerstacks en licht. */
function Stage({ x, z, accent }: { x: number; z: number; accent: string }): JSX.Element {
  return (
    <group position={[x, 0, z]}>
      <Box position={[0, 0.25, 0]} size={[6, 0.5, 3.6]} color="#3a3260" />
      <Box position={[0, 0.54, 0]} size={[5.6, 0.08, 3.3]} color="#584d8c" />
      {[-2.2, 2.2].map((sx) => (
        <group key={sx} position={[sx, 0, -0.9]}>
          <Box position={[0, 1.2, 0]} size={[1, 1.4, 0.9]} color="#221d3c" />
          <Box position={[0, 2.2, 0]} size={[0.9, 0.6, 0.8]} color="#2d2750" />
          <mesh position={[0, 1.2, 0.48]}>
            <circleGeometry args={[0.32, 16]} />
            <meshStandardMaterial color="#141126" />
          </mesh>
        </group>
      ))}
      {/* lichtbrug */}
      <Box position={[0, 3.4, -0.6]} size={[6, 0.16, 0.16]} color="#2a2444" />
      {[-2, -0.7, 0.7, 2].map((lx) => (
        <mesh key={lx} position={[lx, 3.2, -0.6]}>
          <coneGeometry args={[0.22, 0.34, 10]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} />
        </mesh>
      ))}
    </group>
  );
}

export function Dressing({
  office,
  accent,
  width,
  depth,
}: {
  office: OfficeSnapshot;
  accent: string;
  width: number;
  depth: number;
}): JSX.Element | null {
  // Rechtsachter is de vrije hoek: de bureaus staan in het midden, de leiding
  // staat vooraan, en de muurschermen hangen aan de achterwand links. Verder
  // naar binnen dan de wand zelf, want de kadrering van de kantoorcamera loopt
  // niet tot de rechterrand van de ruimte — meubilair dat half buiten beeld
  // staat is meubilair dat je niet hebt.
  const x = width / 2 - 7.8;
  const z = -depth / 2 + 5.6;

  switch (office.kind) {
    case 'fleet':
      return <FleetBay x={x} z={z} />;
    case 'tms':
      return <TmsMap x={x - 0.6} z={z} />;
    case 'trading':
    case 'crypto':
    case 'equities':
      return <TradingWall x={x - 0.4} z={-depth / 2 + 1.2} accent={accent} />;
    case 'design':
      return <DesignCorner x={x} z={z} />;
    case 'studio':
      return <StudioBooth x={x} z={z} />;
    case 'music':
      return <Stage x={x - 0.4} z={z} accent={accent} />;
    default:
      // Generiek: liever niets dan willekeurig meubilair dat niets betekent.
      return null;
  }
}
