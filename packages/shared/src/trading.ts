/**
 * Handelsvoorstellen — de regels die géén LLM kan omzeilen.
 *
 * Een agent stelt een trade voor; dit bestand beslist of dat voorstel door de
 * risicotoets komt. Alle grenzen staan in deterministische code die de agent
 * niet kan lezen, schrijven of overtuigen. Dat is het hele ontwerp: een limiet
 * in een prompt is een suggestie, een limiet in een pure functie is een limiet.
 *
 * Wat hier NIET gebeurt: een order versturen. Dit bestand keurt af of keurt
 * goed; uitvoering loopt via de papieren boekhouding in de collector, of — als
 * de eigenaar dat zelf inricht — via een broker-adapter die hij zelf schrijft
 * en waarvan alleen híj de sleutel heeft. ARA houdt nooit een sleutel met
 * handelsrechten vast.
 */

export type TradeSide = 'buy' | 'sell';

/**
 * De ladder. Hoger dan `paper` zetten is altijd een menselijke handeling;
 * geen agent kan de modus veranderen.
 *
 * - `off`      : niets wordt geboekt, voorstellen worden wel bewaard.
 * - `paper`    : uitvoering tegen een papieren boek. Standaard.
 * - `approval` : elk goedgekeurd voorstel wacht op een expliciet menselijk ja.
 * - `live`     : doorgeven aan de broker-adapter van de eigenaar, binnen de limieten.
 */
export type TradingMode = 'off' | 'paper' | 'approval' | 'live';

export const TRADING_MODES: TradingMode[] = ['off', 'paper', 'approval', 'live'];

export interface TradeIntent {
  id: string;
  createdAt: number;
  /** Tak waaronder dit valt: trading, crypto, equities. */
  venture: string;
  instrument: string;
  side: TradeSide;
  /** Aantal eenheden (aandelen, lots, munten). */
  qty: number;
  entry: number;
  /** Verplicht. Een voorstel zonder stop komt nooit door de toets. */
  stop: number;
  target?: number;
  /** Waarom deze trade — in mensentaal, voor het journaal en de audit. */
  reason: string;
  /** Waar de cijfers vandaan komen. Leeg = afgewezen. */
  sources: string[];
  /** Wie 'm voorstelde (agent-id of rol). */
  proposedBy: string;
}

export interface Position {
  instrument: string;
  side: TradeSide;
  qty: number;
  entry: number;
  stop: number;
  /** Laatst bekende prijs; gebruikt voor blootstelling en drawdown. */
  mark?: number;
  openedAt: number;
}

export interface RiskLimits {
  /** Rekeningwaarde waarop percentages worden berekend. */
  accountValue: number;
  maxRiskPerTradePct: number;
  maxTotalExposurePct: number;
  maxPositionsTotal: number;
  maxPositionsPerInstrument: number;
  /** Bereikt ⇒ de dag wordt automatisch stilgelegd. */
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  /** Witte lijst. Leeg betekent: niets mag. Nooit andersom. */
  allowedInstruments: string[];
  /** Minimale verhouding doel/risico; 0 = geen eis. */
  minRewardRisk: number;
  /** Minuten stilte na een verliestrade. */
  cooldownAfterLossMin: number;
  /** Handelsvenster in UTC-uren en weekdagen (0 = zondag). Weglaten = altijd. */
  tradingHours?: { fromHour: number; toHour: number; days: number[] };
}

export interface PortfolioState {
  positions: Position[];
  /** Gerealiseerd resultaat vandaag, in geld. Negatief = verlies. */
  realizedPnlToday: number;
  equity: number;
  /** Hoogste equity ooit — de basis voor drawdown. */
  peakEquity: number;
  lastLossAt?: number;
}

export interface RiskCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface RiskDecision {
  ok: boolean;
  /** Elke getoetste regel, ook de geslaagde: een afwijzing moet naspeurbaar zijn. */
  checks: RiskCheck[];
  /** Namen van de regels die blokkeerden. */
  blockedBy: string[];
  /** Geld dat op het spel staat als de stop geraakt wordt. */
  riskAmount: number;
  riskPct: number;
  rewardRisk?: number;
}

/**
 * Standaardlimieten: bewust streng, en met een lege witte lijst en een
 * rekeningwaarde van 0 — zo komt er niets doorheen tot de eigenaar zelf
 * limieten heeft gezet. Een systeem dat "werkt" voordat iemand grenzen stelde,
 * is een systeem dat zonder grenzen handelt.
 */
export const DEFAULT_LIMITS: RiskLimits = {
  accountValue: 0,
  maxRiskPerTradePct: 0.5,
  maxTotalExposurePct: 10,
  maxPositionsTotal: 5,
  maxPositionsPerInstrument: 1,
  dailyLossLimitPct: 2,
  maxDrawdownPct: 10,
  allowedInstruments: [],
  minRewardRisk: 1.5,
  cooldownAfterLossMin: 30,
};

const money = (n: number): string => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}`;
const pct = (n: number): string => `${n.toFixed(2)}%`;

/** Geld dat je verliest als de stop geraakt wordt. */
export function riskOf(intent: Pick<TradeIntent, 'qty' | 'entry' | 'stop'>): number {
  return Math.abs(intent.entry - intent.stop) * intent.qty;
}

/** Blootstelling van één positie tegen de laatst bekende prijs. */
export function exposureOf(position: Position): number {
  return (position.mark ?? position.entry) * position.qty;
}

/**
 * Toetst één voorstel tegen alle limieten. Puur: geen tijd, geen I/O, geen
 * willekeur — dezelfde invoer geeft altijd hetzelfde besluit, en dat is
 * precies wat een audit later nodig heeft.
 */
export function evaluateIntent(
  intent: TradeIntent,
  limits: RiskLimits,
  portfolio: PortfolioState,
  now: number,
): RiskDecision {
  const checks: RiskCheck[] = [];
  const add = (rule: string, passed: boolean, detail: string): void => {
    checks.push({ rule, passed, detail });
  };

  // ── 1. Vorm: onzin komt er niet in ──────────────────────────────────────
  const finite = [intent.qty, intent.entry, intent.stop].every((n) => Number.isFinite(n) && n > 0);
  add(
    'geldige getallen',
    finite,
    finite
      ? 'aantal, ingang en stop zijn positieve getallen'
      : 'aantal, ingang of stop is 0, negatief of geen getal',
  );

  // ── 2. Stop verplicht en aan de juiste kant ────────────────────────────
  // Een stop áchter de ingang beschermt niets; dat is een voorstel zonder stop
  // met een getal erbij.
  const stopCorrect =
    finite && (intent.side === 'buy' ? intent.stop < intent.entry : intent.stop > intent.entry);
  add(
    'stop aan de juiste kant',
    stopCorrect,
    stopCorrect
      ? `stop ${intent.stop} ligt ${intent.side === 'buy' ? 'onder' : 'boven'} ingang ${intent.entry}`
      : `stop ${intent.stop} beschermt een ${intent.side} op ${intent.entry} niet`,
  );

  // ── 3. Herkomst: een cijfer zonder bron is een verzinsel ───────────────
  const hasSources = intent.sources.length > 0 && intent.sources.every((s) => s.trim().length > 0);
  add(
    'bron opgegeven',
    hasSources,
    hasSources
      ? `${intent.sources.length} bron(nen)`
      : 'geen bron — een voorstel zonder herkomst komt er niet door',
  );

  const hasReason = intent.reason.trim().length >= 10;
  add(
    'reden opgegeven',
    hasReason,
    hasReason ? 'reden vastgelegd voor het journaal' : 'geen of te korte reden',
  );

  // ── 4. Witte lijst ─────────────────────────────────────────────────────
  // Leeg betekent niets mag. Een lege lijst als "alles mag" lezen is precies
  // hoe een configuratiefout een rekening leegtrekt.
  const allowed = limits.allowedInstruments.includes(intent.instrument);
  add(
    'instrument toegestaan',
    allowed,
    allowed
      ? `${intent.instrument} staat op de witte lijst`
      : `${intent.instrument} staat niet op de witte lijst (${limits.allowedInstruments.length} toegestaan)`,
  );

  // ── 5. Risico per trade ────────────────────────────────────────────────
  const riskAmount = finite ? riskOf(intent) : Number.POSITIVE_INFINITY;
  const riskPct =
    limits.accountValue > 0 ? (riskAmount / limits.accountValue) * 100 : Number.POSITIVE_INFINITY;
  const riskOk = limits.accountValue > 0 && riskPct <= limits.maxRiskPerTradePct;
  add(
    'risico per trade',
    riskOk,
    limits.accountValue > 0
      ? `${money(riskAmount)} = ${pct(riskPct)} van de rekening (max ${pct(limits.maxRiskPerTradePct)})`
      : 'rekeningwaarde staat op 0 — zonder die waarde is geen enkel percentage te toetsen',
  );

  // ── 6. Verhouding doel/risico ──────────────────────────────────────────
  let rewardRisk: number | undefined;
  if (limits.minRewardRisk > 0) {
    if (intent.target === undefined) {
      add(
        'doel/risico',
        false,
        `geen doel opgegeven terwijl minimaal ${limits.minRewardRisk} vereist is`,
      );
    } else {
      const reward = Math.abs(intent.target - intent.entry);
      const risk = Math.abs(intent.entry - intent.stop);
      rewardRisk = risk > 0 ? reward / risk : 0;
      add('doel/risico', rewardRisk >= limits.minRewardRisk, `${rewardRisk.toFixed(2)} (minimaal ${limits.minRewardRisk})`);
    }
  }

  // ── 7. Blootstelling ───────────────────────────────────────────────────
  const currentExposure = portfolio.positions.reduce((sum, p) => sum + exposureOf(p), 0);
  const newExposure = currentExposure + (finite ? intent.entry * intent.qty : 0);
  const exposurePct =
    limits.accountValue > 0 ? (newExposure / limits.accountValue) * 100 : Number.POSITIVE_INFINITY;
  add(
    'totale blootstelling',
    limits.accountValue > 0 && exposurePct <= limits.maxTotalExposurePct,
    `${pct(exposurePct)} na deze trade (max ${pct(limits.maxTotalExposurePct)})`,
  );

  // ── 8. Aantal posities ─────────────────────────────────────────────────
  add(
    'aantal posities',
    portfolio.positions.length < limits.maxPositionsTotal,
    `${portfolio.positions.length} open (max ${limits.maxPositionsTotal})`,
  );

  const perInstrument = portfolio.positions.filter((p) => p.instrument === intent.instrument).length;
  add(
    'posities per instrument',
    perInstrument < limits.maxPositionsPerInstrument,
    `${perInstrument} in ${intent.instrument} (max ${limits.maxPositionsPerInstrument})`,
  );

  // ── 9. Dagverlies ──────────────────────────────────────────────────────
  const lossToday = Math.max(0, -portfolio.realizedPnlToday);
  const lossPct = limits.accountValue > 0 ? (lossToday / limits.accountValue) * 100 : 0;
  add(
    'dagverlieslimiet',
    lossPct < limits.dailyLossLimitPct,
    `${pct(lossPct)} verlies vandaag (limiet ${pct(limits.dailyLossLimitPct)})`,
  );

  // ── 10. Drawdown ───────────────────────────────────────────────────────
  const drawdownPct =
    portfolio.peakEquity > 0
      ? ((portfolio.peakEquity - portfolio.equity) / portfolio.peakEquity) * 100
      : 0;
  add(
    'drawdown',
    drawdownPct < limits.maxDrawdownPct,
    `${pct(drawdownPct)} vanaf de piek (limiet ${pct(limits.maxDrawdownPct)})`,
  );

  // ── 11. Afkoeling na verlies ───────────────────────────────────────────
  // De klassieke manier om een slechte dag erger te maken is meteen terug
  // willen. Dat wachten hoort niet van discipline af te hangen.
  if (limits.cooldownAfterLossMin > 0 && portfolio.lastLossAt !== undefined) {
    const minsSince = (now - portfolio.lastLossAt) / 60_000;
    add(
      'afkoeling na verlies',
      minsSince >= limits.cooldownAfterLossMin,
      `${minsSince.toFixed(0)} min sinds het laatste verlies (nodig ${limits.cooldownAfterLossMin})`,
    );
  }

  // ── 12. Handelsvenster ─────────────────────────────────────────────────
  if (limits.tradingHours) {
    const d = new Date(now);
    const hour = d.getUTCHours();
    const day = d.getUTCDay();
    const { fromHour, toHour, days } = limits.tradingHours;
    // Een venster dat over middernacht loopt (22→04) hoort ook te werken.
    const inHours =
      fromHour <= toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
    add(
      'handelsvenster',
      inHours && days.includes(day),
      `${hour}:00 UTC op dag ${day} (venster ${fromHour}–${toHour} UTC, dagen ${days.join(',')})`,
    );
  }

  const blockedBy = checks.filter((c) => !c.passed).map((c) => c.rule);
  return {
    ok: blockedBy.length === 0,
    checks,
    blockedBy,
    riskAmount: Number.isFinite(riskAmount) ? riskAmount : 0,
    riskPct: Number.isFinite(riskPct) ? riskPct : 0,
    rewardRisk,
  };
}

export interface TradingState {
  mode: TradingMode;
  /** Noodstop. Zolang dit aan staat gebeurt er niets, in geen enkele modus. */
  halted: boolean;
  haltReason: string;
  haltedAt?: number;
  /** Wie de modus als laatste zette — altijd een mens. */
  modeSetBy: string;
  modeSetAt: number;
}

export type ExecutionRoute =
  | { action: 'reject'; why: string }
  | { action: 'paper'; why: string }
  | { action: 'await-approval'; why: string }
  | { action: 'handoff'; why: string };

/**
 * Waar een voorstel heen gaat. Bewust los van de risicotoets: de toets zegt of
 * het mág, dit zegt wat ermee gebeurt. Een noodstop wint altijd.
 *
 * `handoff` betekent: doorgeven aan de broker-adapter van de eigenaar. Die
 * adapter zit niet in deze repo en ARA kent de sleutel niet.
 */
export function routeIntent(state: TradingState, decision: RiskDecision): ExecutionRoute {
  if (state.halted) {
    return {
      action: 'reject',
      why: `noodstop actief: ${state.haltReason || 'geen reden vastgelegd'}`,
    };
  }
  if (!decision.ok) {
    return { action: 'reject', why: `risicotoets: ${decision.blockedBy.join(', ')}` };
  }
  switch (state.mode) {
    case 'off':
      return { action: 'reject', why: 'handel staat uit' };
    case 'paper':
      return { action: 'paper', why: 'papieren uitvoering' };
    case 'approval':
      return { action: 'await-approval', why: 'wacht op menselijk akkoord' };
    case 'live':
      return { action: 'handoff', why: 'binnen alle limieten — doorgeven aan de adapter van de eigenaar' };
  }
}

/**
 * Moet de handel zichzelf stilleggen? Dit draait ná elke afgeronde trade, los
 * van of er een nieuw voorstel ligt — anders merkt het systeem een overschreden
 * limiet pas wanneer iemand toevallig weer wil handelen.
 */
export function autoHaltReason(limits: RiskLimits, portfolio: PortfolioState): string | null {
  if (limits.accountValue <= 0) return null;
  const lossPct = (Math.max(0, -portfolio.realizedPnlToday) / limits.accountValue) * 100;
  if (lossPct >= limits.dailyLossLimitPct) {
    return `dagverlieslimiet geraakt: ${pct(lossPct)} van max ${pct(limits.dailyLossLimitPct)}`;
  }
  const ddPct =
    portfolio.peakEquity > 0
      ? ((portfolio.peakEquity - portfolio.equity) / portfolio.peakEquity) * 100
      : 0;
  if (ddPct >= limits.maxDrawdownPct) {
    return `drawdownlimiet geraakt: ${pct(ddPct)} van max ${pct(limits.maxDrawdownPct)}`;
  }
  return null;
}
