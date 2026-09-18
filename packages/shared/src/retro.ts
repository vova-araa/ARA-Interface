/**
 * Het werkspoor als leesbaar rapport — de organisatie die naar zichzelf kijkt.
 *
 * De vraag die dit beantwoordt is: *waar loopt dit team structureel vast?* Niet
 * "hoe voelt het", niet "wat vindt een model ervan", maar wat er op het bord
 * daadwerkelijk gebeurd is. Daarom rekent en telt dit bestand, puur en zonder
 * I/O, precies zoals `tradereview.ts` dat voor de handel doet.
 *
 * Twee regels die hier hard in zitten:
 *
 * **Een verbetervoorstel zonder bewijs is een mening.** Elke bevinding hier
 * draagt de taken waar hij op gebaseerd is (`evidence`). Een agent die hierop
 * een voorstel schrijft kan dus altijd laten zien waaróm — en wie het leest kan
 * het natrekken in plaats van het te moeten geloven. Zonder die eis krijg je een
 * agent die elke week plausibel klinkende verbeteringen verzint.
 *
 * **Weinig data is geen bevinding.** Onder `RETRO_MIN_SAMPLE` taken zegt een
 * percentage niets: één escalatie op twee taken is geen patroon van 50%. Een rol
 * met te weinig werk krijgt daarom geen oordeel, en dat staat er ook bij.
 */

import { isEscalated } from './office.ts';

export interface RetroTask {
  id: string;
  title: string;
  detail: string;
  project: string;
  assignee: string;
  createdBy: string;
  status: 'open' | 'claimed' | 'done' | 'failed';
  result: string;
  createdAt: number;
  updatedAt: number;
}

/** Eén rol, met wat er van zijn werk terecht is gekomen. */
export interface RoleRow {
  who: string;
  total: number;
  done: number;
  failed: number;
  escalated: number;
  /** Nog open of geclaimd op het moment van meten. */
  pending: number;
  /**
   * Mediaan doorlooptijd van afgeronde taken, in ms. Mediaan en geen
   * gemiddelde: één taak die drie dagen bleef hangen trekt een gemiddelde zo
   * ver weg dat het niets meer over de gewone gang van zaken zegt.
   */
  medianMs?: number;
  /** false = te weinig taken om een percentage van te maken. */
  enoughData: boolean;
}

export type FindingKind =
  /** Werk dat al lang open staat zonder dat er iets mee gebeurt. */
  | 'vastgelopen'
  /** Een rol die vaker escaleert dan de rest — grens of overvraging. */
  | 'escaleert-vaak'
  /** Een rol met mislukte taken. */
  | 'mislukt'
  /** Dezelfde taak keert steeds terug: de oorzaak is nooit weggenomen. */
  | 'herhaalt'
  /** Afgerond zonder te zeggen wat eruit kwam. */
  | 'geen-resultaat'
  /** Een rol die alles doet terwijl de rest stilstaat. */
  | 'scheve-verdeling';

export interface Finding {
  kind: FindingKind;
  /** Eén zin, in de taal van het bord. */
  text: string;
  /** Wie het betreft; leeg als het de hele organisatie raakt. */
  who?: string;
  /**
   * De taken waarop dit rust — id én titel, zodat een voorstel altijd
   * natrekbaar is. Hoogstens `EVIDENCE_LIMIT` stuks; `evidenceTotal` zegt
   * hoeveel er in totaal onder vielen.
   */
  evidence: { id: string; title: string }[];
  evidenceTotal: number;
}

export interface Retro {
  /** Venster waarover gemeten is. */
  from: number;
  to: number;
  /** Alle taken die in dit venster geraakt zijn. */
  considered: number;
  roles: RoleRow[];
  findings: Finding[];
  /**
   * true = er viel te weinig te meten om hier iets uit te concluderen. Dan
   * hoort er geen verbeterronde te draaien: die verzint dan iets.
   */
  tooQuiet: boolean;
  measuredAt: number;
}

/**
 * Drempels. Ze staan hier bij elkaar omdat ze samen bepalen wanneer dit
 * rapport iets durft te zeggen — en omdat een getal dat in een prompt staat
 * een suggestie is, terwijl een getal in een pure functie een grens is.
 */
export const RETRO_THRESHOLDS = {
  /** Minder taken dan dit voor een rol ⇒ geen percentage, geen oordeel. */
  minSample: 5,
  /** Minder taken dan dit in het hele venster ⇒ het rapport houdt zijn mond. */
  minTotal: 8,
  /** Open en niet aangeraakt langer dan dit telt als vastgelopen. */
  stuckMs: 48 * 60 * 60 * 1000,
  /** Vanaf dit aandeel escalaties valt een rol op. */
  escalationShare: 0.3,
  /** Vanaf dit aandeel van al het werk bij één rol is de verdeling scheef. */
  dominantShare: 0.6,
  /** Zo vaak dezelfde titel binnen het venster ⇒ het keert terug. */
  repeatCount: 3,
} as const;

/** Hoeveel bewijsregels een bevinding meedraagt. */
export const EVIDENCE_LIMIT = 5;

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
};

const evidenceOf = (tasks: RetroTask[]): Pick<Finding, 'evidence' | 'evidenceTotal'> => ({
  evidence: tasks.slice(0, EVIDENCE_LIMIT).map((t) => ({ id: t.id, title: t.title })),
  evidenceTotal: tasks.length,
});

/**
 * Voorvoegsels waarmee de watchdog terugkerend werk op het bord zet.
 *
 * Deze lijst hoort gelijk te blijven aan wat `scripts/watchdog.mjs` in sectie 10
 * als titel bouwt. Dat is een echte koppeling en geen mooie: de watchdog is een
 * .mjs zonder buildstap en kan deze TypeScript-module niet importeren, dus staat
 * het op twee plekken. Aan de andere kant staat een comment die hiernaar wijst.
 */
export const CADENCE_PREFIXES = ['Dagelijks:', 'Wekelijks:', 'Maandelijks:'] as const;

/**
 * Terugkerend werk uit het playbook hoort terug te komen — dat is de bedoeling.
 *
 * Zonder deze uitzondering meldt de terugblik elke week dat "Dagelijks: ritten
 * nalooppen" zeven keer op het bord stond en dat de oorzaak nooit is weggenomen.
 * Dat is een bevinding die altijd waar lijkt en nooit iets betekent, en een paar
 * daarvan is genoeg om niemand het rapport meer te laten lezen.
 */
export function isRecurringDuty(title: string): boolean {
  return CADENCE_PREFIXES.some((prefix) => title.startsWith(prefix));
}

/**
 * Normaliseert een titel zodat "CHAT: hoe staat blex ervoor" van maandag en die
 * van dinsdag als dezelfde terugkerende taak tellen. Cijfers, datums en tijden
 * eruit: die maken elke herhaling uniek en dan zie je een patroon nooit.
 */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRetro(tasks: RetroTask[], from: number, to: number, now: number): Retro {
  const considered = tasks.filter((t) => t.updatedAt >= from && t.updatedAt <= to);
  const findings: Finding[] = [];

  // ── Per rol ───────────────────────────────────────────────────────────
  const byRole = new Map<string, RetroTask[]>();
  for (const task of considered) {
    const key = task.assignee || '(niemand)';
    const list = byRole.get(key) ?? [];
    list.push(task);
    byRole.set(key, list);
  }

  const roles: RoleRow[] = [...byRole.entries()]
    .map(([who, list]) => {
      const done = list.filter((t) => t.status === 'done');
      return {
        who,
        total: list.length,
        done: done.length,
        failed: list.filter((t) => t.status === 'failed').length,
        escalated: list.filter((t) => isEscalated(t)).length,
        pending: list.filter((t) => t.status === 'open' || t.status === 'claimed').length,
        medianMs: median(done.map((t) => t.updatedAt - t.createdAt)),
        enoughData: list.length >= RETRO_THRESHOLDS.minSample,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Te stil om iets te durven zeggen. Dit is geen storing en ook geen
  // "alles gaat goed" — er is simpelweg niet genoeg gebeurd om uit te lezen.
  const tooQuiet = considered.length < RETRO_THRESHOLDS.minTotal;
  if (tooQuiet) {
    return { from, to, considered: considered.length, roles, findings, tooQuiet, measuredAt: now };
  }

  // ── Vastgelopen werk ──────────────────────────────────────────────────
  // Let op: hier kijken we naar álle taken, niet alleen naar het venster. Een
  // taak die drie weken open staat is juist onzichtbaar in een venster van een
  // week, en dat is precies het soort werk dat blijft liggen.
  const stuck = tasks
    .filter((t) => t.status === 'open' || t.status === 'claimed')
    .filter((t) => now - t.updatedAt > RETRO_THRESHOLDS.stuckMs)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  if (stuck.length > 0) {
    const oldestDays = Math.floor((now - stuck[0]!.updatedAt) / (24 * 60 * 60 * 1000));
    findings.push({
      kind: 'vastgelopen',
      text: `${stuck.length} taak/taken staan langer dan twee dagen stil; de oudste ${oldestDays} dag(en).`,
      ...evidenceOf(stuck),
    });
  }

  // ── Per rol: escalaties, mislukkingen, lege resultaten ────────────────
  for (const row of roles) {
    const list = byRole.get(row.who)!;

    if (row.enoughData && row.escalated / row.total >= RETRO_THRESHOLDS.escalationShare) {
      const hits = list.filter((t) => isEscalated(t));
      findings.push({
        kind: 'escaleert-vaak',
        who: row.who,
        // Bewust twee lezingen naast elkaar: het is óf een grens die klopt en
        // dan hoort het werk ergens anders, óf een rol die te weinig middelen
        // heeft. Welke van de twee kan dit rapport niet zien.
        text: `${row.who} escaleert ${hits.length} van ${row.total} taken — of het werk hoort hier niet, of deze rol mist iets om het af te maken.`,
        ...evidenceOf(hits),
      });
    }

    if (row.failed > 0) {
      const hits = list.filter((t) => t.status === 'failed');
      findings.push({
        kind: 'mislukt',
        who: row.who,
        text: `${row.who} heeft ${row.failed} mislukte taak/taken.`,
        ...evidenceOf(hits),
      });
    }

    // Afgerond zonder te zeggen wát eruit kwam. Een taak zonder resultaat is
    // niet na te trekken; dan weet niemand of hij echt af is.
    const silent = list.filter((t) => t.status === 'done' && t.result.trim() === '');
    if (silent.length > 0) {
      findings.push({
        kind: 'geen-resultaat',
        who: row.who,
        text: `${row.who} sloot ${silent.length} taak/taken af zonder resultaat — niet na te trekken.`,
        ...evidenceOf(silent),
      });
    }
  }

  // ── Werk dat blijft terugkomen ────────────────────────────────────────
  const byTitle = new Map<string, RetroTask[]>();
  for (const task of considered) {
    // Ritme-taken horen terug te komen; zie isRecurringDuty.
    if (isRecurringDuty(task.title)) continue;
    const key = titleKey(task.title);
    const list = byTitle.get(key) ?? [];
    list.push(task);
    byTitle.set(key, list);
  }
  for (const [, list] of byTitle) {
    if (list.length < RETRO_THRESHOLDS.repeatCount) continue;
    findings.push({
      kind: 'herhaalt',
      text: `"${list[0]!.title}" stond ${list.length}× op het bord — de oorzaak is blijkbaar nooit weggenomen.`,
      ...evidenceOf(list),
    });
  }

  // ── Verdeling ─────────────────────────────────────────────────────────
  const busiest = roles[0];
  if (busiest && roles.length > 1 && busiest.total / considered.length >= RETRO_THRESHOLDS.dominantShare) {
    findings.push({
      kind: 'scheve-verdeling',
      who: busiest.who,
      text: `${busiest.who} draagt ${busiest.total} van ${considered.length} taken; de rest van de organisatie staat er grotendeels naast.`,
      ...evidenceOf(byRole.get(busiest.who)!),
    });
  }

  return { from, to, considered: considered.length, roles, findings, tooQuiet, measuredAt: now };
}

/**
 * Het rapport als bericht. Net als bij het handelsrapport komt de tekst uit
 * dezelfde module als de cijfers, zodat het bericht nooit iets anders kan
 * melden dan wat er gemeten is.
 */
export function formatRetroMessage(retro: Retro): string {
  const days = Math.max(1, Math.round((retro.to - retro.from) / (24 * 60 * 60 * 1000)));
  if (retro.tooQuiet) {
    return [
      `🔍 ARA — terugblik over ${days} dag(en)`,
      `${retro.considered} taak/taken geraakt. Te weinig om iets uit te lezen.`,
      'Er draait geen verbeterronde: die zou hier iets moeten verzinnen.',
    ].join('\n');
  }
  const lines = [
    `🔍 ARA — terugblik over ${days} dag(en)`,
    `${retro.considered} taak/taken, ${retro.roles.length} rol(len) actief.`,
  ];
  if (retro.findings.length === 0) {
    lines.push('Geen patronen gevonden die om aandacht vragen.');
    return lines.join('\n');
  }
  lines.push('');
  for (const finding of retro.findings) {
    lines.push(`• ${finding.text}`);
    if (finding.evidenceTotal > finding.evidence.length) {
      lines.push(`  (${finding.evidence.length} van ${finding.evidenceTotal} getoond)`);
    }
  }
  return lines.join('\n');
}
