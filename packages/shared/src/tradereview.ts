/**
 * Het handelsspoor als leesbaar rapport.
 *
 * De vraag die dit moet beantwoorden is er één: *zou dit hebben gewerkt, en is
 * de discipline op orde?* Daar hoort geen gevoel bij en geen verhaal, dus dit
 * bestand rekent en telt — puur, zonder I/O — en de rest van het systeem mag
 * er hooguit een zin omheen schrijven.
 *
 * Eén ding staat er met opzet hard in: **papieren resultaten vleien**. Er zit
 * geen spread in, geen slippage, geen gemiste vulling, en elke ingang is
 * precies gehaald. Een papieren winst is dus een bovengrens, nooit een
 * verwachting. Die waarschuwing hoort in de data te zitten, niet alleen in de
 * begeleidende tekst — want de tekst leest iemand een keer, en het getal
 * onthoudt hij.
 */

export interface ReviewIntent {
  id: string;
  createdAt: number;
  venture: string;
  instrument: string;
  side: 'buy' | 'sell';
  proposedBy: string;
  /** rejected · paper-filled · awaiting · handoff */
  status: string;
  route: string;
  mode: string;
  /** Regels die blokkeerden; leeg bij een geslaagde toets. */
  blockedBy: string[];
  riskPct: number;
  rewardRisk?: number;
}

export interface ReviewPosition {
  instrument: string;
  side: 'buy' | 'sell';
  qty: number;
  entry: number;
  stop: number;
  openedAt: number;
  closedAt: number;
  exitPrice: number;
  pnl: number;
}

export interface Counted {
  key: string;
  count: number;
  /** Aandeel van het totaal, 0–1. */
  share: number;
}

export interface ProposerRow {
  who: string;
  proposals: number;
  accepted: number;
  rejected: number;
  /** Waar deze indiener het vaakst op stukliep. */
  topBlocker?: string;
}

export interface Retry {
  who: string;
  instrument: string;
  /** Minuten tussen de afwijzing en het nieuwe voorstel. */
  minutes: number;
  blockedBy: string[];
}

export interface ReadinessCheck {
  criterion: string;
  met: boolean;
  detail: string;
}

export interface TradeReview {
  window: { from: number; to: number; days: number };
  proposals: {
    total: number;
    accepted: number;
    rejected: number;
    awaiting: number;
    /** Dagen binnen het venster waarop überhaupt iets is voorgesteld. */
    activeDays: number;
  };
  /** Welke regels het vaakst tegenhielden — de belangrijkste tabel. */
  blockers: Counted[];
  byProposer: ProposerRow[];
  byInstrument: Counted[];
  paper: {
    closed: number;
    wins: number;
    losses: number;
    /** 0–1; alleen zinvol vanaf een stuk of dertig trades. */
    winRate: number;
    pnl: number;
    /** Gemiddelde uitkomst in R (veelvoud van het risico). */
    avgR: number;
    bestR: number;
    worstR: number;
    /** Verwachtingswaarde per trade in R. Negatief = het systeem verliest. */
    expectancyR: number;
  };
  /** Voorstellen die kort na een afwijzing terugkwamen — dat hoort niet. */
  retries: Retry[];
  /** Waarom deze cijfers mooier zijn dan de werkelijkheid. */
  caveats: string[];
  /** Zijn de eigen drempels gehaald? Geen advies — een aftekenlijst. */
  readiness: ReadinessCheck[];
}

/**
 * Het rapport als kort bericht, voor Telegram of een andere smalle kanaal.
 *
 * Bewust hier en niet in de watchdog: dan is de tekst te testen en telt niemand
 * onderweg iets na. Wat hier staat is wat de eigenaar op zondagavond op zijn
 * telefoon leest, dus het moet in één blik te lezen zijn — en de waarschuwing
 * over papieren vullingen hoort erbij, juist omdat het bericht kort is.
 */
export function formatReviewMessage(review: TradeReview): string {
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  const lines: string[] = [`📊 ARA World — handel, ${review.window.days} dagen`];

  if (review.proposals.total === 0) {
    // Geen voorstellen is óók een bericht waard: als de handel aanstaat en er
    // gebeurt een week lang niets, is er meestal iets stuk in plaats van rustig.
    lines.push('', 'Geen enkel voorstel in dit venster.');
    return lines.join('\n');
  }

  lines.push(
    '',
    `${review.proposals.total} voorstel(len) op ${review.proposals.activeDays} dag(en): ` +
      `${review.proposals.accepted} door, ${review.proposals.rejected} afgewezen` +
      (review.proposals.awaiting > 0 ? `, ${review.proposals.awaiting} WACHT OP JOU` : ''),
  );

  if (review.blockers.length > 0) {
    lines.push('', 'Waarop het stukliep:');
    for (const b of review.blockers.slice(0, 3)) {
      lines.push(`· ${b.key} — ${b.count}× (${pct(b.share)})`);
    }
  }

  if (review.paper.closed > 0) {
    lines.push(
      '',
      `Papier: ${review.paper.closed} afgerond, ${pct(review.paper.winRate)} trefkans, ` +
        `${review.paper.expectancyR.toFixed(2)}R per trade`,
    );
  } else {
    lines.push('', 'Papier: nog niets afgerond.');
  }

  // Herhaalpogingen bovenaan de aandacht: dat is gedrag, geen pech.
  if (review.retries.length > 0) {
    lines.push('', `⚠️ ${review.retries.length}× opnieuw ingediend na een afwijzing — dat hoort niet.`);
  }

  const open = review.readiness.filter((c) => !c.met);
  lines.push(
    '',
    open.length === 0
      ? 'Alle drempels gehaald (dat is een aftekenlijst, geen advies).'
      : `Nog niet gehaald: ${open.map((c) => c.criterion).join('; ')}.`,
  );
  lines.push('', 'Papieren vullingen kennen geen spread of slippage: dit is een bovengrens.');
  return lines.join('\n');
}

/** Drempels waaronder cijfers niets zeggen. Bewust conservatief. */
export const REVIEW_THRESHOLDS = {
  minClosedTrades: 30,
  minActiveDays: 20,
  /** Aandeel afwijzingen op vorm (bron/reden) dat nog acceptabel is. */
  maxFormRejectShare: 0.1,
  /** Binnen dit venster telt een nieuw voorstel als herhaalpoging. */
  retryWindowMin: 60,
};

/** Afwijzingen die over de vorm van het voorstel gaan, niet over de markt. */
const FORM_RULES = new Set(['bron opgegeven', 'reden opgegeven', 'geldige getallen', 'stop aan de juiste kant']);

function tally(values: string[]): Counted[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const total = values.length || 1;
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const dayKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

/**
 * Bouwt het rapport. `now` komt van buiten zodat een rapport over een vast
 * venster altijd dezelfde uitkomst geeft — een rapport dat vandaag anders
 * rekent dan morgen, kun je niet naast elkaar leggen.
 */
export function buildTradeReview(
  intents: ReviewIntent[],
  positions: ReviewPosition[],
  days: number,
  now: number,
): TradeReview {
  const from = now - days * 24 * 60 * 60 * 1000;
  const window = intents.filter((i) => i.createdAt >= from);
  const closed = positions.filter((p) => p.closedAt >= from);

  const accepted = window.filter((i) => i.status === 'paper-filled' || i.status === 'handoff');
  const rejected = window.filter((i) => i.status === 'rejected');
  const awaiting = window.filter((i) => i.status === 'awaiting');

  // ── Wie liep waarop stuk ────────────────────────────────────────────────
  const byProposer: ProposerRow[] = [...new Set(window.map((i) => i.proposedBy))]
    .map((who) => {
      const mine = window.filter((i) => i.proposedBy === who);
      const blocked = tally(mine.flatMap((i) => i.blockedBy));
      return {
        who: who || '(onbekend)',
        proposals: mine.length,
        accepted: mine.filter((i) => i.status === 'paper-filled' || i.status === 'handoff').length,
        rejected: mine.filter((i) => i.status === 'rejected').length,
        topBlocker: blocked[0]?.key,
      };
    })
    .sort((a, b) => b.proposals - a.proposals);

  // ── Herhaalpogingen: afgewezen, en kort daarna hetzelfde opnieuw ────────
  // Dit is de gedragsfout waar de risicomotor juist tegen moet beschermen: een
  // voorstel bijschaven tot het er net doorheen past.
  const retries: Retry[] = [];
  const sorted = [...window].sort((a, b) => a.createdAt - b.createdAt);
  for (const [index, intent] of sorted.entries()) {
    if (intent.status !== 'rejected') continue;
    const later = sorted.slice(index + 1).find(
      (next) =>
        next.proposedBy === intent.proposedBy &&
        next.instrument === intent.instrument &&
        next.side === intent.side &&
        next.createdAt - intent.createdAt <= REVIEW_THRESHOLDS.retryWindowMin * 60_000,
    );
    if (later) {
      retries.push({
        who: intent.proposedBy,
        instrument: intent.instrument,
        minutes: Math.round((later.createdAt - intent.createdAt) / 60_000),
        blockedBy: intent.blockedBy,
      });
    }
  }

  // ── Papieren uitkomst in R ──────────────────────────────────────────────
  // In R, niet in euro's: een resultaat in geld zegt alleen iets samen met de
  // inzet, en de inzet verschilt per trade.
  const rMultiples = closed.map((p) => {
    const risk = Math.abs(p.entry - p.stop) * p.qty;
    return risk > 0 ? p.pnl / risk : 0;
  });
  const wins = rMultiples.filter((r) => r > 0).length;
  const losses = rMultiples.filter((r) => r < 0).length;
  const sum = rMultiples.reduce((a, b) => a + b, 0);

  const formRejects = rejected.filter((i) => i.blockedBy.some((rule) => FORM_RULES.has(rule))).length;
  const formShare = rejected.length > 0 ? formRejects / rejected.length : 0;
  const activeDays = new Set(window.map((i) => dayKey(i.createdAt))).size;
  const expectancyR = rMultiples.length > 0 ? sum / rMultiples.length : 0;

  const readiness: ReadinessCheck[] = [
    {
      criterion: `minstens ${REVIEW_THRESHOLDS.minClosedTrades} afgeronde papieren trades`,
      met: closed.length >= REVIEW_THRESHOLDS.minClosedTrades,
      detail: `${closed.length} afgerond`,
    },
    {
      criterion: `minstens ${REVIEW_THRESHOLDS.minActiveDays} dagen met voorstellen`,
      met: activeDays >= REVIEW_THRESHOLDS.minActiveDays,
      detail: `${activeDays} van de ${days} dagen`,
    },
    {
      criterion: 'positieve verwachtingswaarde in R',
      met: rMultiples.length > 0 && expectancyR > 0,
      detail:
        rMultiples.length > 0
          ? `${expectancyR.toFixed(2)}R per trade over ${rMultiples.length} trade${rMultiples.length === 1 ? '' : 's'}`
          : 'nog geen afgeronde trades',
    },
    {
      criterion: 'afwijzingen op vorm onder de 10%',
      met: formShare <= REVIEW_THRESHOLDS.maxFormRejectShare,
      detail:
        rejected.length > 0
          ? `${(formShare * 100).toFixed(0)}% van de afwijzingen ging over bron, reden of stop`
          : 'geen afwijzingen',
    },
    {
      criterion: 'geen herhaalpogingen na een afwijzing',
      met: retries.length === 0,
      detail: retries.length === 0 ? 'geen gezien' : `${retries.length} keer opnieuw ingediend binnen een uur`,
    },
    {
      criterion: 'niets blijft op akkoord wachten',
      met: awaiting.length === 0,
      detail: `${awaiting.length} wachtend`,
    },
  ];

  return {
    window: { from, to: now, days },
    proposals: {
      total: window.length,
      accepted: accepted.length,
      rejected: rejected.length,
      awaiting: awaiting.length,
      activeDays,
    },
    blockers: tally(rejected.flatMap((i) => i.blockedBy)),
    byProposer,
    byInstrument: tally(window.map((i) => i.instrument)),
    paper: {
      closed: closed.length,
      wins,
      losses,
      winRate: rMultiples.length > 0 ? wins / rMultiples.length : 0,
      pnl: closed.reduce((a, p) => a + p.pnl, 0),
      avgR: expectancyR,
      bestR: rMultiples.length > 0 ? Math.max(...rMultiples) : 0,
      worstR: rMultiples.length > 0 ? Math.min(...rMultiples) : 0,
      expectancyR,
    },
    retries,
    caveats: [
      'Papieren vullingen kennen geen spread, geen slippage en geen gemiste order: elke ingang werd precies gehaald. Deze uitkomst is dus een bovengrens, nooit een verwachting.',
      'Stops zijn niet getoetst tegen intraday-beweging; een stop die in het echt geraakt zou zijn, kan hier zijn blijven staan.',
      'Kosten, financiering en belasting zitten er niet in.',
      rMultiples.length < REVIEW_THRESHOLDS.minClosedTrades
        ? `Met ${rMultiples.length} afgeronde trade${rMultiples.length === 1 ? '' : 's'} zegt de trefkans statistisch nog niets.`
        : 'Let op de verwachtingswaarde in R, niet op de trefkans: veel kleine winsten en één grote verliezer is een verliezend systeem.',
    ],
    readiness,
  };
}
