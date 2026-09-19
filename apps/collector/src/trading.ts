import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LIMITS,
  TRADING_MODES,
  type PortfolioState,
  type Position,
  type RiskLimits,
  type TradingMode,
  type TradingState,
} from '@ara/shared';
import { DATA_DIR } from './config.ts';

/**
 * Handelslaag van de collector: limieten, modus, noodstop en het papieren boek.
 *
 * Twee dingen staan hier bewust buiten het bereik van elke agent:
 *
 * 1. **De modus boven `paper`** kan alleen omhoog als `ARA_TRADING_UNLOCK` in de
 *    omgeving van de collector staat. Die zet de eigenaar zelf op zijn Mac. Een
 *    agent die het API-pad vindt, of zelfs het token heeft, komt er niet langs:
 *    het slot zit in de omgeving van het proces, niet in een verzoek.
 * 2. **De limieten** komen uit een bestand waarvan we de vingerafdruk bewaren.
 *    Verandert die buiten een herstart om, dan is dat een gebeurtenis die de
 *    eigenaar hoort te zien — niet iets dat stil doorwerkt.
 *
 * Er zit in deze repo géén broker-koppeling. In `live` levert de collector een
 * *handoff*: het goedgekeurde voorstel komt klaar te staan voor de adapter die
 * de eigenaar zelf draait, met zijn eigen sleutel. ARA houdt nooit een sleutel
 * met handelsrechten vast — dat is geen beperking maar het ontwerp.
 */

// Paden en het slot worden bij gebruik gelezen, niet bij het laden van de
// module. Anders ligt de configuratie vast op het moment dat iets anders deze
// module toevallig als eerste importeerde — en dan verandert een gewijzigde
// omgeving niets meer, wat je pas merkt als het ertoe doet.
export const limitsPath = (): string =>
  process.env.ARA_TRADING_LIMITS ?? path.join(process.env.ARA_DATA_DIR ?? DATA_DIR, 'trading-limits.json');
const statePath = (): string => path.join(process.env.ARA_DATA_DIR ?? DATA_DIR, 'trading-state.json');

/** Zonder dit in de omgeving blijft de modus op `off` of `paper`. */
export const unlocked = (): boolean => process.env.ARA_TRADING_UNLOCK === 'yes-i-accept-the-risk';

export interface LimitsReport {
  limits: RiskLimits;
  /** Waar ze vandaan kwamen — of dat het standaard is omdat er geen bestand staat. */
  source: string;
  /** Vingerafdruk, zodat een stille wijziging zichtbaar wordt. */
  fingerprint: string;
  /** Wat er mis is met de configuratie; leeg = bruikbaar. */
  problems: string[];
}

function fingerprintOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Leest de limieten van schijf. Ontbreekt het bestand of klopt het niet, dan
 * val je terug op DEFAULT_LIMITS — die laat niets door (lege witte lijst,
 * rekeningwaarde 0). Een kapotte configuratie mag nooit ruimer uitpakken dan
 * een goede.
 */
export function readLimits(): LimitsReport {
  const problems: string[] = [];
  let raw = '';
  try {
    raw = fs.readFileSync(limitsPath(), 'utf8');
  } catch {
    return {
      limits: DEFAULT_LIMITS,
      source: 'standaard (geen trading-limits.json)',
      fingerprint: 'geen',
      problems: [`geen ${limitsPath()} — er komt niets doorheen tot je limieten zet`],
    };
  }

  let parsed: Partial<RiskLimits> = {};
  try {
    parsed = JSON.parse(raw) as Partial<RiskLimits>;
  } catch (error) {
    return {
      limits: DEFAULT_LIMITS,
      source: limitsPath(),
      fingerprint: fingerprintOf(raw),
      problems: [`trading-limits.json is geen geldige JSON (${String(error).slice(0, 80)})`],
    };
  }

  const num = (key: keyof RiskLimits, fallback: number): number => {
    const value = parsed[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      if (value !== undefined) problems.push(`${key}: geen bruikbaar getal, standaard gebruikt`);
      return fallback;
    }
    return value;
  };

  const allowed = Array.isArray(parsed.allowedInstruments)
    ? parsed.allowedInstruments.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  if (allowed.length === 0) problems.push('allowedInstruments is leeg — geen enkel instrument mag');

  const limits: RiskLimits = {
    accountValue: num('accountValue', 0),
    maxRiskPerTradePct: num('maxRiskPerTradePct', DEFAULT_LIMITS.maxRiskPerTradePct),
    maxTotalExposurePct: num('maxTotalExposurePct', DEFAULT_LIMITS.maxTotalExposurePct),
    maxPositionsTotal: num('maxPositionsTotal', DEFAULT_LIMITS.maxPositionsTotal),
    maxPositionsPerInstrument: num('maxPositionsPerInstrument', DEFAULT_LIMITS.maxPositionsPerInstrument),
    dailyLossLimitPct: num('dailyLossLimitPct', DEFAULT_LIMITS.dailyLossLimitPct),
    maxDrawdownPct: num('maxDrawdownPct', DEFAULT_LIMITS.maxDrawdownPct),
    allowedInstruments: allowed,
    minRewardRisk: num('minRewardRisk', DEFAULT_LIMITS.minRewardRisk),
    cooldownAfterLossMin: num('cooldownAfterLossMin', DEFAULT_LIMITS.cooldownAfterLossMin),
    tradingHours: parsed.tradingHours,
  };
  if (limits.accountValue <= 0) problems.push('accountValue staat op 0 — geen percentage is te toetsen');

  return { limits, source: limitsPath(), fingerprint: fingerprintOf(raw), problems };
}

const FRESH_STATE: TradingState = {
  mode: 'paper',
  halted: false,
  haltReason: '',
  modeSetBy: 'standaard',
  modeSetAt: 0,
};

export function readState(): TradingState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Partial<TradingState>;
    const mode = TRADING_MODES.includes(parsed.mode as TradingMode) ? (parsed.mode as TradingMode) : 'paper';
    return {
      // Een opgeslagen `live` zonder slot in de omgeving zakt terug naar paper.
      // Anders zou één keer ontgrendelen voor altijd gelden, ook na een herstart
      // waarin de eigenaar het slot juist wegliet.
      mode: unlocked() || mode === 'off' || mode === 'paper' ? mode : 'paper',
      halted: parsed.halted === true,
      haltReason: typeof parsed.haltReason === 'string' ? parsed.haltReason : '',
      haltedAt: typeof parsed.haltedAt === 'number' ? parsed.haltedAt : undefined,
      modeSetBy: typeof parsed.modeSetBy === 'string' ? parsed.modeSetBy : 'onbekend',
      modeSetAt: typeof parsed.modeSetAt === 'number' ? parsed.modeSetAt : 0,
    };
  } catch {
    return { ...FRESH_STATE };
  }
}

export function writeState(state: TradingState): void {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export interface ModeChange {
  ok: boolean;
  state: TradingState;
  why: string;
}

/**
 * Modus wijzigen. Omhoog boven `paper` kan alleen met het slot uit de omgeving;
 * omlaag kan altijd — veiliger worden mag nooit geblokkeerd zijn.
 */
export function setMode(mode: TradingMode, by: string, now: number): ModeChange {
  const current = readState();
  if (!TRADING_MODES.includes(mode)) {
    return { ok: false, state: current, why: `onbekende modus "${mode}"` };
  }
  const raises = (mode === 'approval' || mode === 'live') && current.mode !== mode;
  if (raises && !unlocked()) {
    return {
      ok: false,
      state: current,
      why:
        'ARA_TRADING_UNLOCK staat niet in de omgeving van de collector. Zet die zelf op de Mac ' +
        'en herstart de collector; dit kan niet via de API, met opzet.',
    };
  }
  const next: TradingState = { ...current, mode, modeSetBy: by, modeSetAt: now };
  writeState(next);
  return { ok: true, state: next, why: `modus staat nu op ${mode}` };
}

export function halt(reason: string, now: number): TradingState {
  const next: TradingState = { ...readState(), halted: true, haltReason: reason, haltedAt: now };
  writeState(next);
  return next;
}

/** Hervatten zet de modus bewust terug op `paper`: je begint niet live weer. */
export function resume(by: string, now: number): TradingState {
  const current = readState();
  const next: TradingState = {
    ...current,
    halted: false,
    haltReason: '',
    haltedAt: undefined,
    mode: current.mode === 'off' ? 'off' : 'paper',
    modeSetBy: by,
    modeSetAt: now,
  };
  writeState(next);
  return next;
}

/** Berekent de stand van het papieren boek uit de openstaande posities. */
export function portfolioFrom(positions: Position[], realizedPnlToday: number, limits: RiskLimits, lastLossAt?: number): PortfolioState {
  const open = positions.reduce((sum, p) => sum + ((p.mark ?? p.entry) - p.entry) * p.qty * (p.side === 'buy' ? 1 : -1), 0);
  const equity = limits.accountValue + realizedPnlToday + open;
  return {
    positions,
    realizedPnlToday,
    equity,
    // Zonder eigen historie is de piek minstens de startwaarde; zo meet
    // drawdown vanaf een echt punt in plaats van vanaf nul.
    peakEquity: Math.max(limits.accountValue, equity),
    lastLossAt,
  };
}
