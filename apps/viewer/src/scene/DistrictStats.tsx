import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { axialToWorld, SESSION_TTL_MS, visibleInWorld, type WorldConfig } from '@ara/shared';
import { HEX_SPACING, projectPlacement } from '../placements.ts';
import { useAra, useViewSnapshot } from '../store.ts';
import { withToken, loadUsage, type BoardTask, type UsageRow } from '../api.ts';
import { STATUS_COLORS } from '../util.ts';
import { groundTop } from './terrain.ts';

/**
 * Districtbord: hoe een tak ervoor staat, leesbaar vanaf de kaart.
 *
 * Je moest een kantoor binnenlopen om te zien of er iets speelde. Dat is één
 * klik te veel voor de vraag die je het vaakst stelt — "waar moet ik kijken?".
 *
 * Dit bord volgt dezelfde lijn als de Gemeten-tab (apps/collector/src/pulse.ts):
 * **niet meetbaar ⇒ de regel ontbreekt**. Er wordt hier nóóit een getal
 * ingevuld om een bord netjes te vullen, en een nul wordt niet getoond alsof
 * het nieuws is. Een district zonder sessies zegt "geen sessies" — dat is een
 * meting (de reducer kent alle sessies), geen opvulling. Kan iets niet
 * toegewezen worden aan een tak, dan staat die regel er domweg niet.
 */


/** Bovengrens van de bord-uitvraag. Komen er precies zoveel taken terug, dan is
 *  het districtaantal een ondergrens en zegt het bord "≥". */
const TASK_LIMIT = 200;
/** Het bord ververst op een bord-gebeurtenis, niet per frame — maar een reeks
 *  gebeurtenissen achter elkaar mag geen reeks verzoeken worden. */
const TASK_MIN_GAP_MS = 10_000;
const USAGE_REFRESH_MS = 60_000;

/** Hoe ver buiten het districthart het bord staat (wereldeenheden). */
const BOARD_OUTWARD = 2.6;
/** Hoogte van de onderrand boven de grond van het districthart. */
const BOARD_LIFT = 0.5;

// Canvas → wereld. Eén factor, zodat regelhoogte en tekstgrootte samen schalen.
const DPR = 3;
const FONT_PX = 24;
/** Kleinere bijzin op dezelfde regel ("vandaag"): draagt betekenis, mag geen
 *  halve bordbreedte kosten. */
const NOTE_PX = 19;
const ROW_PX = 34;
const PAD_X = 16;
const PAD_Y = 10;
const DOT_R = 5;
/**
 * Onder een ortho-camera is zoom = pixels per wereldeenheid, en de rustzoom
 * ligt rond de 33 op een laptop. 0,014 geeft daar ~11px letters — gelijk aan
 * de naamlabels, dus het bord is niet ineens een ander soort tekst.
 *
 * Ver uitgezoomd (en op een telefoon, die daar bij de rustzoom al zit) zou
 * diezelfde maat 5px worden. Dan staan er nog maar één of twee regels, dus
 * die mogen groter: liever één leesbare waarschuwing dan vijf onleesbare.
 */
const WORLD_PER_PX_NEAR = 0.014;
const WORLD_PER_PX_FAR = 0.028;

const TONE_TASKS = '#c6cfdd';
const TONE_TOKENS = '#e6b800';
const TONE_QUIET = STATUS_COLORS.idle!;
const TONE_NOTE = '#9aa5b5';

interface StatLine {
  text: string;
  /** Kleine, doffe toevoeging achter de tekst (bv. het tijdvenster). */
  note?: string;
  tone: string;
}

/** Nederlandse getalnotatie zonder toLocaleString: die hangt van de
 *  browserlocale af en dan toont hetzelfde bord op twee apparaten iets anders. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** Eén bord als canvas-sprite: alle regels in één textuur, dus één draw call
 *  per district in plaats van één per regel. Ortho-veilig (geen distanceFactor). */
function drawBoard(
  lines: StatLine[],
  accent: string,
): { texture: THREE.CanvasTexture; width: number; height: number } {
  const measure = document.createElement('canvas').getContext('2d')!;
  const textWidth = lines.reduce((w, line) => {
    measure.font = `600 ${FONT_PX}px -apple-system, sans-serif`;
    let width = measure.measureText(line.text).width;
    if (line.note) {
      measure.font = `500 ${NOTE_PX}px -apple-system, sans-serif`;
      width += measure.measureText(` ${line.note}`).width;
    }
    return Math.max(w, width);
  }, 0);
  const width = Math.ceil(textWidth) + PAD_X * 2 + DOT_R * 2 + 12;
  const height = PAD_Y * 2 + lines.length * ROW_PX;

  const canvas = document.createElement('canvas');
  canvas.width = width * DPR;
  canvas.height = height * DPR;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);

  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, 12);
  ctx.fillStyle = 'rgba(10, 12, 16, 0.92)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const y = PAD_Y + ROW_PX * i + ROW_PX / 2;
    // Gekleurde stip in plaats van een emoji: een cijfer met een rode stip
    // ervoor leest ook op tien pixels hoogte nog, en het hangt niet af van
    // welke emoji-set het apparaat toevallig heeft.
    ctx.beginPath();
    ctx.arc(PAD_X + DOT_R, y, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = line.tone;
    ctx.fill();
    // Schaduw onder de letters: houdt de tekst leesbaar boven een lichte gevel
    // én boven een donkere heuvel, zonder een tweede tekstlaag.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 6;
    const x = PAD_X + DOT_R * 2 + 10;
    ctx.font = `600 ${FONT_PX}px -apple-system, sans-serif`;
    ctx.fillStyle = '#f4f6fa';
    ctx.fillText(line.text, x, y + 1);
    if (line.note) {
      const after = x + ctx.measureText(line.text).width;
      ctx.font = `500 ${NOTE_PX}px -apple-system, sans-serif`;
      ctx.fillStyle = TONE_NOTE;
      ctx.fillText(` ${line.note}`, after, y + 2);
    }
    ctx.shadowBlur = 0;
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width, height };
}

function BoardSprite({
  lines,
  accent,
  position,
  scale,
  muted,
}: {
  lines: StatLine[];
  accent: string;
  position: [number, number, number];
  scale: number;
  muted: boolean;
}): JSX.Element {
  // De inhoud is de sleutel: zolang de tekst gelijk blijft, wordt er niets
  // opnieuw getekend — een event per seconde mag geen textuur per seconde zijn.
  const key = lines.map((l) => `${l.tone}|${l.text}|${l.note ?? ''}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const board = useMemo(() => drawBoard(lines, accent), [key, accent]);
  useEffect(() => () => board.texture.dispose(), [board]);

  const w = board.width * scale;
  const h = board.height * scale;
  return (
    <sprite position={[position[0], position[1] + h / 2, position[2]]} renderOrder={19} scale={[w, h, 1]}>
      {/* Onder de naamlabels (renderOrder 20) maar boven de bebouwing: een
          cijfer dat achter een dak verdwijnt is geen cijfer. Een bord dat
          niets te melden heeft zakt naar de achtergrond in plaats van te
          verdwijnen: je moet kunnen zien dat er gekeken is. */}
      <spriteMaterial
        map={board.texture}
        transparent
        opacity={muted ? 0.5 : 1}
        depthWrite={false}
        depthTest={false}
      />
    </sprite>
  );
}

/** Open bordtaken. Trigger is `tasksVersion` (SSE), niet de klok — met een
 *  ondergrens van 10s ertussen, zodat een drukke minuut geen verzoekenregen is. */
function useOpenTasks(enabled: boolean): { tasks: BoardTask[]; truncated: boolean } | null {
  const tasksVersion = useAra((s) => s.tasksVersion);
  const [result, setResult] = useState<{ tasks: BoardTask[]; truncated: boolean } | null>(null);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetchTasks = async (): Promise<void> => {
      lastAt.current = Date.now();
      try {
        const res = await fetch(withToken(`/tasks?status=open&limit=${TASK_LIMIT}`));
        const body = (await res.json()) as { tasks?: BoardTask[] };
        if (cancelled || !body.tasks) return;
        setResult({ tasks: body.tasks, truncated: body.tasks.length >= TASK_LIMIT });
      } catch {
        // Collector onbereikbaar: de vorige meting laten staan. Zodra de SSE
        // wegvalt verdwijnen deze regels toch (zie `measurable` hieronder).
      }
    };
    const wait = Math.max(0, TASK_MIN_GAP_MS - (Date.now() - lastAt.current));
    const timer = setTimeout(() => void fetchTasks(), wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, tasksVersion]);

  return result;
}

/** Tokens van vandaag per project (dezelfde bron als de usage-tabel). */
function useUsage(enabled: boolean): UsageRow[] | null {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = (): void =>
      void loadUsage().then((res) => {
        if (!cancelled) setRows(res.usage);
      });
    refresh();
    const timer = setInterval(refresh, USAGE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return rows;
}

export function DistrictStats({ world }: { world: WorldConfig }): JSX.Element | null {
  const snapshot = useViewSnapshot();
  const lodFar = useAra((s) => s.lodFar);
  const perfLow = useAra((s) => s.perfLow);
  const demo = useAra((s) => s.demo);
  const connected = useAra((s) => s.connected);
  const replayTs = useAra((s) => s.replayTs);
  const filterVenture = useAra((s) => s.filterVenture);

  // Fixture-events komen nooit in de db: bord en usage horen bij de echte
  // wereld, niet bij de demo. Tijdens terugscrubben zijn ze er ook niet bij —
  // "open taken" en "tokens vandaag" zijn cijfers van nú en zeggen niets over
  // een moment van drie uur geleden. Ze dan tonen naast een oude sessiestand
  // is precies het soort halve waarheid dat dit bord niet hoort te vertellen.
  const live = !demo && connected;
  const measurable = live && replayTs === null;
  const tasks = useOpenTasks(live);
  const usage = useUsage(live);

  // Ver weg of op een zwak apparaat alleen het hoogstnodige: wat op een mens
  // wacht en wat stuk staat. De rest kost tekst die je toch niet leest.
  const compact = lodFar || perfLow;

  const boards = useMemo(() => {
    const now = snapshot.now;

    const active = new Map<string, number>();
    const running = new Map<string, number>();
    const waiting = new Map<string, number>();
    const failing = new Map<string, number>();
    const bump = (map: Map<string, number>, venture: string): void =>
      void map.set(venture, (map.get(venture) ?? 0) + 1);

    for (const session of Object.values(snapshot.sessions)) {
      // Dezelfde grens als de bovenbalk (actief = niet geëindigd en recent
      // gezien) en dezelfde zichtbaarheidsregel als de pods: het bord telt wat
      // er in dat district daadwerkelijk staat.
      if (session.endedAt || now - session.lastSeenAt >= SESSION_TTL_MS) continue;
      if (!visibleInWorld(world, session.project)) continue;
      const venture = projectPlacement(world, session.project).venture;
      bump(active, venture);
      if (session.status === 'working') bump(running, venture);
      if (session.needsHuman) bump(waiting, venture);
      if (session.status === 'error') bump(failing, venture);
    }

    const openTasks = new Map<string, number>();
    if (measurable && tasks) {
      for (const task of tasks.tasks) {
        if (!task.project || !visibleInWorld(world, task.project)) continue;
        bump(openTasks, projectPlacement(world, task.project).venture);
      }
    }

    const tokens = new Map<string, number>();
    if (measurable && usage) {
      for (const row of usage) {
        // Niet toe te wijzen aan een tak ⇒ niet meegeteld en nergens getoond.
        // Liever een regel die ontbreekt dan een totaal dat ergens bij hoort
        // waar het niet vandaan komt.
        if (!visibleInWorld(world, row.project)) continue;
        const venture = projectPlacement(world, row.project).venture;
        // Cache-reads tellen niet mee, net als in de usage-tabel.
        tokens.set(venture, (tokens.get(venture) ?? 0) + row.inputTokens + row.outputTokens);
      }
    }

    return world.districts.map((district) => {
      const id = district.venture.id;
      const lines: StatLine[] = [];
      const work = running.get(id) ?? 0;
      const human = waiting.get(id) ?? 0;
      const broken = failing.get(id) ?? 0;
      const open = openTasks.get(id) ?? 0;
      const used = tokens.get(id) ?? 0;

      if (human > 0) {
        lines.push({
          text: human === 1 ? '1 wacht op jou' : `${human} wachten op jou`,
          tone: STATUS_COLORS.needsHuman!,
        });
      }
      if (broken > 0) {
        lines.push({ text: `${broken} fout`, tone: STATUS_COLORS.error! });
      }
      if (!compact) {
        if (work > 0) {
          lines.push({
            text: work === 1 ? '1 draait' : `${work} draaien`,
            tone: STATUS_COLORS.working!,
          });
        }
        if (open > 0) {
          // Zat de uitvraag aan zijn plafond, dan is dit een ondergrens en
          // zegt het bord dat ook.
          const prefix = tasks?.truncated ? '≥' : '';
          lines.push({
            text: open === 1 ? `${prefix}1 taak open` : `${prefix}${open} taken open`,
            tone: TONE_TASKS,
          });
        }
        // Het tijdvenster staat erbij: /usage telt vanaf middernacht, en een
        // token-getal zonder venster nodigt uit tot de verkeerde lezing.
        if (used > 0) {
          lines.push({ text: `${fmtTokens(used)} tokens`, note: 'vandaag', tone: TONE_TOKENS });
        }
        // Niets te melden is zelf een meting: de reducer kent álle sessies, dus
        // dit is geen ingevulde nul maar een uitkomst. Twee gevallen, want ze
        // zeggen iets anders: er is hier niemand aan het werk, of er zijn wel
        // sessies maar geen van alle vraagt iets van je. Alleen ingezoomd, en
        // alleen zolang we live meekijken — offline weten we het niet.
        if (lines.length === 0 && live) {
          const idle = active.get(id) ?? 0;
          lines.push({ text: idle === 0 ? 'geen sessies' : 'niets te melden', tone: TONE_QUIET });
        }
      }

      if (lines.length === 0) return null;
      // Gefilterd op één tak? Dan gaan de borden van de rest mee uit beeld,
      // net als de pods.
      if (filterVenture && filterVenture !== id) return null;

      const { x, z } = axialToWorld(district.center);
      const wx = x * HEX_SPACING;
      const wz = z * HEX_SPACING;
      // Naar buiten toe van de hub af: in het hart van het district staat het
      // landmark en staan de naamlabels, en daar hoort geen tweede paneel bij.
      const len = Math.hypot(wx, wz) || 1;
      return {
        key: id,
        accent: district.venture.color,
        lines,
        quiet: lines.length === 1 && lines[0]!.tone === TONE_QUIET,
        position: [
          wx + (wx / len) * BOARD_OUTWARD,
          groundTop(district.center) + BOARD_LIFT,
          wz + (wz / len) * BOARD_OUTWARD,
        ] as [number, number, number],
      };
    });
  }, [snapshot, world, tasks, usage, measurable, live, compact, filterVenture]);

  const visible = boards.filter((b): b is NonNullable<typeof b> => b !== null);
  if (visible.length === 0) return null;

  return (
    <group>
      {visible.map((board) => (
        <BoardSprite
          key={board.key}
          lines={board.lines}
          accent={board.accent}
          position={board.position}
          scale={compact ? WORLD_PER_PX_FAR : WORLD_PER_PX_NEAR}
          muted={board.quiet}
        />
      ))}
    </group>
  );
}
