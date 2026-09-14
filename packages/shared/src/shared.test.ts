import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AraEventSchema, IncomingEventSchema } from './schema.ts';
import { redactString, redactValue, capText } from './redact.ts';
import { hexRing, hexDisc, placeOnFreeHex, axialKey, stableHash } from './hex.ts';
import { buildWorldConfig, ventureForProject, placementForProject } from './world.ts';

test('AraEventSchema accepts a valid event', () => {
  const event = AraEventSchema.parse({
    id: 'e1',
    ts: Date.now(),
    kind: 'tool.pre',
    sessionId: 's1',
    cwd: '/home/user/traject',
    project: 'traject-tms',
    tool: 'Bash',
  });
  assert.equal(event.kind, 'tool.pre');
});

test('IncomingEventSchema allows missing id/ts/project', () => {
  const event = IncomingEventSchema.parse({ kind: 'session.start', sessionId: 's1', cwd: '/x' });
  assert.equal(event.sessionId, 's1');
});

test('redactString strips api keys and tokens', () => {
  assert.ok(!redactString('key sk-ant-abc123def456ghi789 here').includes('sk-ant-abc123'));
  assert.ok(!redactString('ghp_abcdefghijklmnopqrstuv123456').includes('ghp_'));
  assert.ok(redactString('api_key = supersecretvalue123').includes('[REDACTED]'));
});

test('redactValue redacts nested secret-ish keys', () => {
  const out = redactValue({ apiKey: 'abc', nested: { password: 'x', ok: 'fine' } }) as {
    apiKey: string;
    nested: { password: string; ok: string };
  };
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.nested.password, '[REDACTED]');
  assert.equal(out.nested.ok, 'fine');
});

test('capText caps at 200 chars', () => {
  const long = 'a'.repeat(500);
  assert.equal(capText(long)!.length, 200);
});

test('hexRing/hexDisc sizes', () => {
  assert.equal(hexRing({ q: 0, r: 0 }, 1).length, 6);
  assert.equal(hexDisc({ q: 0, r: 0 }, 2).length, 19);
});

test('placeOnFreeHex is deterministic and collision-free', () => {
  const takenA = new Set<string>();
  const takenB = new Set<string>();
  const a1 = placeOnFreeHex('traject', { q: 0, r: 0 }, takenA);
  const b1 = placeOnFreeHex('traject', { q: 0, r: 0 }, takenB);
  assert.deepEqual(a1, b1);
  const a2 = placeOnFreeHex('blex', { q: 0, r: 0 }, takenA);
  assert.notEqual(axialKey(a1), axialKey(a2));
});

test('stableHash is stable', () => {
  assert.equal(stableHash('ara-world'), stableHash('ara-world'));
});

test('ventureForProject matches by substring', () => {
  assert.equal(ventureForProject('traject-tms').id, 'traject');
  assert.equal(ventureForProject('some-random-repo').id, 'misc');
});

test('buildWorldConfig places every project exactly once', () => {
  const config = buildWorldConfig(
    [{ name: 'traject-tms' }, { name: 'blex-app' }, { name: 'vovara-site' }, { name: 'mystery' }],
    123,
  );
  const names = config.districts.flatMap((d) => d.projects.map((p) => p.name));
  assert.deepEqual(names.sort(), ['blex-app', 'mystery', 'traject-tms', 'vovara-site']);
  const centers = config.districts.flatMap((d) => d.projects.map((p) => axialKey(p.center)));
  assert.equal(new Set(centers).size, centers.length);
});

test('doneToday counts each session once despite multiple completion events', async () => {
  const { WorldState } = await import('./state.ts');
  const state = new WorldState();
  const base = Date.now();
  const ev = (kind: 'session.start' | 'task.completed' | 'session.end', offset: number) => ({
    id: `${kind}-${offset}`,
    ts: base + offset,
    kind,
    sessionId: 'sx',
    cwd: '/x',
    project: 'p',
  });
  state.apply(ev('session.start', 0));
  state.apply(ev('task.completed', 10));
  state.apply(ev('session.end', 20));
  assert.equal(state.snapshot().counters.doneToday, 1);
});

test('hiddenVentures: leeg misc-district vervalt; onbekende projecten onzichtbaar', async () => {
  const { visibleInWorld } = await import('./world.ts');
  const config = buildWorldConfig([{ name: 'traject-tms' }], 123, { hiddenVentures: ['misc'] });
  assert.ok(!config.districts.some((d) => d.venture.id === 'misc'));
  assert.equal(visibleInWorld(config, 'traject-tms'), true);
  assert.equal(visibleInWorld(config, 'random-onbekend-repo'), false);
  // Expliciet project in misc → data wint, district blijft.
  const withMisc = buildWorldConfig([{ name: 'mystery-lab' }], 123, { hiddenVentures: ['misc'] });
  assert.ok(withMisc.districts.some((d) => d.venture.id === 'misc'));
  assert.equal(visibleInWorld(withMisc, 'mystery-lab'), true);
});

test('placementForProject invents a stable slot for unknown projects', () => {
  const config = buildWorldConfig([{ name: 'traject-tms' }], 123);
  const p1 = placementForProject(config, 'brand-new');
  const p2 = placementForProject(config, 'brand-new');
  assert.deepEqual(p1.center, p2.center);
  assert.equal(p1.venture, 'misc');
});

test('nieuwe hook-kinds: model, permissie, compaction, worktree in de reducer', async () => {
  const { WorldState } = await import('./state.ts');
  const state = new WorldState();
  const base = Date.now();
  const ev = (kind: string, offset: number, extra: Record<string, unknown> = {}) =>
    ({ id: `${kind}-${offset}`, ts: base + offset, kind, sessionId: 'sm', cwd: '/x', project: 'p', ...extra }) as never;

  state.apply(ev('session.start', 0, { model: 'claude-haiku-4-5' }));
  assert.equal(state.snapshot().sessions['sm']!.model, 'claude-haiku-4-5');

  state.apply(ev('model.switch', 10, { model: 'claude-fable-5' }));
  assert.equal(state.snapshot().sessions['sm']!.model, 'claude-fable-5');

  state.apply(ev('permission.ask', 20, { message: 'permissie: Bash' }));
  let s = state.snapshot().sessions['sm']!;
  assert.equal(s.status, 'needsHuman');
  assert.equal(s.needsHuman, true);

  // Geslaagde tool na goedkeuring heft needsHuman op.
  state.apply(ev('tool.post', 30, { tool: 'Bash', status: 'ok' }));
  s = state.snapshot().sessions['sm']!;
  assert.equal(s.needsHuman, false);
  assert.equal(s.status, 'working');

  state.apply(ev('compact.start', 40));
  assert.equal(state.snapshot().sessions['sm']!.compacting, true);
  state.apply(ev('compact.end', 45));
  assert.equal(state.snapshot().sessions['sm']!.compacting, false);

  state.apply(ev('worktree.start', 50));
  state.apply(ev('worktree.start', 51));
  assert.equal(state.snapshot().sessions['sm']!.worktrees, 2);
  state.apply(ev('worktree.stop', 60));
  assert.equal(state.snapshot().sessions['sm']!.worktrees, 1);

  state.apply(ev('permission.deny', 70));
  assert.equal(state.snapshot().sessions['sm']!.needsHuman, false);
});

test('buildOffice: elke branche krijgt zijn eigen werkplekken en taal', async () => {
  const { buildOffice, officeKindForVenture } = await import('./office.ts');
  const { VENTURES } = await import('./world.ts');
  const venture = (id: string) => VENTURES.find((v) => v.id === id)!;
  const base = { sessions: [], tasks: [], now: 1_700_000_000_000 };

  const fleet = buildOffice({ ...base, project: 'truck-trailers', venture: venture('blex') });
  assert.equal(fleet.kind, 'fleet');
  assert.ok(fleet.stations.length > 0);
  assert.ok(fleet.stations[0]!.metrics.some((m) => m.label === 'Kenteken'), 'wagenpark kent kentekens');

  const tms = buildOffice({ ...base, project: 'sharzi-tms', venture: venture('traject') });
  assert.equal(tms.kind, 'tms');
  assert.ok(tms.stations[0]!.metrics.some((m) => m.label === 'Chauffeur'), 'planning kent chauffeurs');

  const crypto = buildOffice({ ...base, project: 'crypto-desk', venture: venture('crypto') });
  assert.equal(crypto.kind, 'crypto');
  assert.equal(crypto.valueKind, 'money');
  assert.ok(crypto.stations[0]!.metrics.some((m) => m.label === 'Stop'), 'crypto kent stops');

  // Deterministisch: hetzelfde project levert exact hetzelfde kantoor.
  const again = buildOffice({ ...base, project: 'crypto-desk', venture: venture('crypto') });
  assert.deepEqual(
    crypto.stations.map((s) => s.value),
    again.stations.map((s) => s.value),
  );
  assert.equal(officeKindForVenture('onbekend'), 'generic');
});

test('buildOffice: echte data wint, maar maakt de rest niet stiekem echt', async () => {
  const { buildOffice, STATION_STALE_MS } = await import('./office.ts');
  const { VENTURES } = await import('./world.ts');
  const now = Date.now();
  const office = buildOffice({
    project: 'crypto-desk',
    venture: VENTURES.find((v) => v.id === 'crypto')!,
    sessions: [],
    tasks: [],
    overrides: [{ id: 'BTC', status: 'alert', value: 123.45, sub: '9 setups', updatedAt: now }],
    now,
  });
  const btc = office.stations.find((s) => s.id === 'BTC')!;
  assert.equal(btc.status, 'alert');
  assert.equal(btc.value, 123.45);
  assert.equal(btc.simulated, false, 'deze werkplek heeft een bron');
  assert.equal(btc.stale, false);

  // De kern: één echte werkplek mag de andere niet als echt laten doorgaan.
  const eth = office.stations.find((s) => s.id === 'ETH')!;
  assert.equal(eth.simulated, true, 'zonder eigen bron blijft een werkplek voorbeeld');
  assert.ok(eth.metrics.every((m) => m.estimated), 'al zijn cijfers zijn gemarkeerd');
  assert.equal(office.realStations, 1);
  assert.equal(office.simulated, false, 'er is íets echt');
  assert.ok(office.headline.estimated, 'de portefeuillestand wordt door niets gevoed');
  assert.ok(office.chartEstimated, 'de grafiek is een invulling');
  assert.ok(
    office.kpis.filter((k) => k.estimated).length >= 2,
    'niet-gevoede KPI\'s staan als voorbeeld gemarkeerd',
  );

  // Een koppeling die te lang niets stuurde, mag niet als live doorgaan.
  const dead = buildOffice({
    project: 'crypto-desk',
    venture: VENTURES.find((v) => v.id === 'crypto')!,
    sessions: [],
    tasks: [],
    overrides: [{ id: 'BTC', value: 1, updatedAt: now - STATION_STALE_MS - 1000 }],
    now,
  });
  assert.equal(dead.stations.find((s) => s.id === 'BTC')!.stale, true);
  assert.equal(dead.staleStations, 1);
});

test('buildOffice: live agents bemannen de werkplekken en staan in het team', async () => {
  const { buildOffice } = await import('./office.ts');
  const { VENTURES } = await import('./world.ts');
  const now = Date.now();
  const office = buildOffice({
    project: 'crypto-desk',
    venture: VENTURES.find((v) => v.id === 'crypto')!,
    sessions: [
      {
        sessionId: 's1',
        project: 'crypto-desk',
        cwd: '/x',
        startedAt: now,
        lastSeenAt: now,
        status: 'working',
        needsHuman: false,
        toolCount: 3,
        errorCount: 0,
        agents: {
          a1: {
            agentId: 'a1',
            agentType: 'ara-web-scout',
            sessionId: 's1',
            startedAt: now,
            lastSeenAt: now,
            stopped: false,
            lastToolSummary: 'grep orderbook',
          },
        },
      },
    ],
    tasks: [],
    now,
  });
  assert.equal(office.stations[0]!.agentName, 'ara-web-scout');
  assert.ok(office.staff.some((s) => s.role === 'scout' && s.busyWith === 'grep orderbook'));
  assert.ok(office.staff.some((s) => s.role === 'supervisor'), 'de chief staat altijd in het kantoor');
  assert.ok(office.staff.some((s) => s.role === 'manager'), 'elke tak heeft een manager');
});

test('buildOffice: de meetlaag vult nooit iets in', async () => {
  const { buildOffice } = await import('./office.ts');
  const { VENTURES } = await import('./world.ts');
  const venture = VENTURES.find((v) => v.id === 'crypto')!;
  const now = 1_700_000_000_000;
  const base = { project: 'crypto-desk', venture, sessions: [], tasks: [], now };

  // Zonder meting hoort er geen enkele regel te staan — geen nul, geen streepje.
  const zonder = buildOffice(base);
  assert.equal(zonder.measured.length, 0, 'geen pulse ⇒ geen gemeten regels');
  assert.equal(zonder.pulse, undefined);

  // Met meting: alleen de velden die er écht zijn, en nooit als schatting.
  const met = buildOffice({
    ...base,
    pulse: {
      branch: 'main',
      commitsToday: 3,
      dirtyFiles: 0,
      lastCommitAt: now - 5 * 60 * 1000,
      measuredAt: now,
      // commits7d, tokensToday, openTasks ontbreken bewust
    },
  });
  const labels = met.measured.map((m) => m.label);
  assert.ok(labels.includes('Branch'));
  assert.ok(labels.includes('Commits vandaag'));
  assert.ok(labels.includes('Onopgeslagen wijzigingen'), '0 wijzigingen is een meting, geen gat');
  assert.ok(!labels.includes('Commits 7 dagen'), 'niet gemeten ⇒ niet getoond');
  assert.ok(!labels.includes('Tokens vandaag'), 'niet gemeten ⇒ niet getoond');
  assert.ok(
    met.measured.every((m) => m.estimated === false),
    'geen enkele gemeten regel mag als schatting gemarkeerd staan',
  );
  assert.equal(met.measured.find((m) => m.label === 'Laatste commit')!.value, '5 min geleden');

  // De meetlaag verandert niets aan de eerlijkheid van de werkplekken zelf:
  // git-commits maken een verzonnen muntkoers niet echt.
  assert.equal(met.simulated, true);
  assert.equal(met.realStations, 0);
});

test('playbook: elke tak krijgt eigen rollen, grenzen en databronnen', async () => {
  const { resolvePlaybook, playbookPrompt } = await import('./org.ts');

  // Zonder org.json-invoer valt een tak terug op het branche-standaard —
  // nooit op een leeg playbook.
  const tms = resolvePlaybook('traject', 'Sharzi TMS');
  assert.equal(tms.managerName, 'Manager Sharzi TMS');
  assert.ok(tms.specialists.some((s) => s.agent === 'ara-planner'), 'planning krijgt een ritplanner');
  assert.ok(tms.duties.length > 0 && tms.escalate.length > 0);

  const fleet = resolvePlaybook('blex', 'Truck & Trailers');
  assert.ok(fleet.specialists.some((s) => s.agent === 'ara-fleet-tech'), 'wagenpark krijgt een monteur');
  assert.ok(!fleet.specialists.some((s) => s.agent === 'ara-planner'), 'en geen ritplanner');

  // De read-only grens van de handel staat in het playbook zelf, niet alleen
  // in een promptregel die iemand kan vergeten mee te sturen.
  for (const id of ['trading', 'crypto']) {
    const book = resolvePlaybook(id, id);
    assert.ok(book.specialists.some((s) => s.agent === 'ara-market-analyst'));
    assert.ok(
      book.escalate.some((e) => /orderlogica/i.test(e)) && book.escalate.some((e) => /sleutel/i.test(e)),
      `${id}: orderlogica én sleutels horen hard te escaleren`,
    );
  }

  // Elke tak heeft de cijferaanvoer, anders blijft het kantoor op voorbeelden draaien.
  for (const id of ['traject', 'blex', 'trading', 'crypto', 'elevate', 'uprising', 'vovara']) {
    assert.ok(
      resolvePlaybook(id, id).specialists.some((s) => s.agent === 'ara-reporter'),
      `${id} mist de cijferaanvoer`,
    );
  }

  // Wat de gebruiker invult wint; wat hij weglaat komt uit het standaard.
  const eigen = resolvePlaybook('traject', 'Sharzi TMS', { managerName: 'Manager Ritplanning' });
  assert.equal(eigen.managerName, 'Manager Ritplanning');
  assert.deepEqual(eigen.specialists, tms.specialists);

  // De promptvorm noemt de niet-aangesloten bronnen expliciet, zodat een
  // manager weet dat daar niets te halen valt in plaats van iets te verzinnen.
  const prompt = playbookPrompt(tms);
  assert.match(prompt, /ALTIJD escaleren/);
  assert.match(prompt, /Nog niet aangesloten databronnen/);
});

test('buildOffice: het kantoor toont de vaste rollen, ook als er niemand draait', async () => {
  const { buildOffice } = await import('./office.ts');
  const { resolvePlaybook } = await import('./org.ts');
  const { VENTURES } = await import('./world.ts');
  const venture = VENTURES.find((v) => v.id === 'blex')!;
  const playbook = resolvePlaybook('blex', venture.label, { managerName: 'Manager Wagenpark' });

  const office = buildOffice({
    project: 'truck-trailers',
    venture,
    sessions: [],
    tasks: [],
    playbook,
    now: 1_700_000_000_000,
  });

  const manager = office.staff.find((s) => s.role === 'manager')!;
  assert.equal(manager.name, 'Manager Wagenpark');
  assert.equal(manager.live, false, 'zonder sessie is de manager niet live');

  const tech = office.staff.find((s) => s.agent === 'ara-fleet-tech')!;
  assert.ok(tech, 'de vaste rol staat in het kantoor');
  assert.equal(tech.live, false);
  assert.match(tech.status, /niet actief/, 'een lege stoel is zichtbaar leeg');
  assert.ok(tech.does && tech.does.length > 0);

  assert.equal(office.playbook?.managerName, 'Manager Wagenpark');
});

test('risicotoets: elke limiet blokkeert aantoonbaar', async () => {
  const { evaluateIntent, DEFAULT_LIMITS, routeIntent, autoHaltReason } = await import('./trading.ts');
  const now = Date.UTC(2026, 0, 6, 12, 0); // dinsdag 12:00 UTC

  const limits = {
    ...DEFAULT_LIMITS,
    accountValue: 100_000,
    maxRiskPerTradePct: 1,
    maxTotalExposurePct: 20,
    maxPositionsTotal: 3,
    maxPositionsPerInstrument: 1,
    dailyLossLimitPct: 2,
    maxDrawdownPct: 10,
    allowedInstruments: ['XAUUSD', 'ASML'],
    minRewardRisk: 1.5,
    cooldownAfterLossMin: 30,
  };
  const flat = { positions: [], realizedPnlToday: 0, equity: 100_000, peakEquity: 100_000 };
  // 10 eenheden, 20 punten risico = 200 = 0,2% van de rekening. Doel geeft 3R.
  const good = {
    id: 't1',
    createdAt: now,
    venture: 'trading',
    instrument: 'XAUUSD',
    side: 'buy' as const,
    qty: 10,
    entry: 2000,
    stop: 1980,
    target: 2060,
    reason: 'uitbraak boven de weekopening, bevestigd op het uur',
    sources: ['bot-status.json 12:00'],
    proposedBy: 'ara-market-analyst',
  };

  const base = evaluateIntent(good, limits, flat, now);
  assert.equal(base.ok, true, base.blockedBy.join(', '));
  assert.equal(base.riskAmount, 200);
  assert.ok(Math.abs(base.riskPct - 0.2) < 1e-9);
  assert.equal(base.rewardRisk, 3);

  // Elke regel afzonderlijk: wijzig één ding, en precies die regel hoort te vallen.
  const blocks: [string, () => ReturnType<typeof evaluateIntent>][] = [
    ['stop aan de juiste kant', () => evaluateIntent({ ...good, stop: 2020 }, limits, flat, now)],
    ['bron opgegeven', () => evaluateIntent({ ...good, sources: [] }, limits, flat, now)],
    ['reden opgegeven', () => evaluateIntent({ ...good, reason: 'kort' }, limits, flat, now)],
    ['instrument toegestaan', () => evaluateIntent({ ...good, instrument: 'DOGE' }, limits, flat, now)],
    ['risico per trade', () => evaluateIntent({ ...good, qty: 200 }, limits, flat, now)],
    ['doel/risico', () => evaluateIntent({ ...good, target: 2010 }, limits, flat, now)],
    ['geldige getallen', () => evaluateIntent({ ...good, qty: 0 }, limits, flat, now)],
    [
      'totale blootstelling',
      () =>
        evaluateIntent(good, limits, {
          ...flat,
          positions: [{ instrument: 'ASML', side: 'buy', qty: 100, entry: 190, openedAt: now, stop: 180 }],
        }, now),
    ],
    [
      'posities per instrument',
      () =>
        evaluateIntent(good, limits, {
          ...flat,
          positions: [{ instrument: 'XAUUSD', side: 'buy', qty: 1, entry: 2000, openedAt: now, stop: 1990 }],
        }, now),
    ],
    ['dagverlieslimiet', () => evaluateIntent(good, limits, { ...flat, realizedPnlToday: -2500 }, now)],
    ['drawdown', () => evaluateIntent(good, limits, { ...flat, equity: 88_000 }, now)],
    ['afkoeling na verlies', () => evaluateIntent(good, limits, { ...flat, lastLossAt: now - 60_000 }, now)],
  ];
  for (const [rule, run] of blocks) {
    const decision = run();
    assert.equal(decision.ok, false, `${rule} had moeten blokkeren`);
    assert.ok(decision.blockedBy.includes(rule), `verwachtte blokkade op "${rule}", kreeg: ${decision.blockedBy.join(', ')}`);
  }

  // Een lege witte lijst betekent NIETS mag — nooit "alles mag".
  const empty = evaluateIntent(good, { ...limits, allowedInstruments: [] }, flat, now);
  assert.equal(empty.ok, false);
  assert.ok(empty.blockedBy.includes('instrument toegestaan'));

  // Rekeningwaarde 0 (nog niets ingesteld) laat niets door.
  const unset = evaluateIntent(good, { ...limits, accountValue: 0 }, flat, now);
  assert.equal(unset.ok, false);
  assert.ok(unset.blockedBy.includes('risico per trade'));

  // Elke toets komt in de uitslag, ook de geslaagde — anders is een afwijzing
  // niet naspeurbaar.
  assert.ok(base.checks.length >= 11);
  assert.ok(base.checks.every((c) => c.detail.length > 0));

  // Handelsvenster, inclusief een venster dat over middernacht loopt.
  const nightLimits = { ...limits, tradingHours: { fromHour: 22, toHour: 4, days: [0, 1, 2, 3, 4, 5, 6] } };
  assert.equal(evaluateIntent(good, nightLimits, flat, Date.UTC(2026, 0, 6, 23)).ok, true);
  assert.equal(evaluateIntent(good, nightLimits, flat, Date.UTC(2026, 0, 6, 2)).ok, true);
  assert.equal(evaluateIntent(good, nightLimits, flat, now).ok, false);

  // ── Routering: de noodstop wint van alles ────────────────────────────────
  const live = { mode: 'live' as const, halted: false, haltReason: '', modeSetBy: 'vova', modeSetAt: now };
  assert.equal(routeIntent(live, base).action, 'handoff');
  assert.equal(routeIntent({ ...live, mode: 'paper' }, base).action, 'paper');
  assert.equal(routeIntent({ ...live, mode: 'approval' }, base).action, 'await-approval');
  assert.equal(routeIntent({ ...live, mode: 'off' }, base).action, 'reject');
  const halted = routeIntent({ ...live, halted: true, haltReason: 'handmatig' }, base);
  assert.equal(halted.action, 'reject', 'een noodstop blokkeert ook in live');
  assert.match(halted.why, /noodstop/);
  // Een afgekeurd voorstel gaat nergens heen, ook niet in live.
  assert.equal(routeIntent(live, empty).action, 'reject');

  // ── Zelf stilleggen bij een geraakte limiet ─────────────────────────────
  assert.equal(autoHaltReason(limits, flat), null);
  assert.match(String(autoHaltReason(limits, { ...flat, realizedPnlToday: -2000 })), /dagverlies/);
  assert.match(String(autoHaltReason(limits, { ...flat, equity: 90_000 })), /drawdown/);
});

test('handelsrapport: telt wat er gebeurde en vleit niet', async () => {
  const { buildTradeReview, REVIEW_THRESHOLDS } = await import('./tradereview.ts');
  const now = Date.UTC(2026, 0, 20, 12);
  const day = 24 * 60 * 60 * 1000;
  const mk = (over: Partial<Parameters<typeof buildTradeReview>[0][number]>) => ({
    id: Math.random().toString(36).slice(2),
    createdAt: now - day,
    venture: 'trading',
    instrument: 'XAUUSD',
    side: 'buy' as const,
    proposedBy: 'ara-execution-trader',
    status: 'paper-filled',
    route: 'paper',
    mode: 'paper',
    blockedBy: [] as string[],
    riskPct: 0.2,
    ...over,
  });

  const intents = [
    mk({}),
    mk({ status: 'rejected', blockedBy: ['risico per trade'] }),
    mk({ status: 'rejected', blockedBy: ['risico per trade', 'totale blootstelling'] }),
    mk({ status: 'rejected', blockedBy: ['bron opgegeven'], proposedBy: 'ara-market-analyst' }),
    mk({ status: 'awaiting', instrument: 'ASML' }),
    // Buiten het venster: mag niet meetellen.
    mk({ createdAt: now - 30 * day, status: 'rejected', blockedBy: ['drawdown'] }),
  ];

  // Eén winnaar van 2R, één verliezer van -1R ⇒ verwachting +0,5R.
  const positions = [
    { instrument: 'XAUUSD', side: 'buy' as const, qty: 10, entry: 2000, stop: 1980, openedAt: now - day, closedAt: now - day / 2, exitPrice: 2040, pnl: 400 },
    { instrument: 'XAUUSD', side: 'buy' as const, qty: 10, entry: 2000, stop: 1980, openedAt: now - day, closedAt: now - day / 3, exitPrice: 1980, pnl: -200 },
  ];

  const r = buildTradeReview(intents, positions, 7, now);

  // Het venster snijdt echt af.
  assert.equal(r.proposals.total, 5, 'een voorstel van 30 dagen oud telt niet mee in 7 dagen');
  assert.equal(r.proposals.accepted, 1);
  assert.equal(r.proposals.rejected, 3);
  assert.equal(r.proposals.awaiting, 1);
  assert.ok(!r.blockers.some((b) => b.key === 'drawdown'), 'blokkades van buiten het venster tellen niet');

  // De belangrijkste tabel: wat hield het vaakst tegen.
  assert.equal(r.blockers[0]!.key, 'risico per trade');
  assert.equal(r.blockers[0]!.count, 2);

  // Per indiener, inclusief waar hij op stukliep.
  const analyst = r.byProposer.find((p) => p.who === 'ara-market-analyst')!;
  assert.equal(analyst.rejected, 1);
  assert.equal(analyst.topBlocker, 'bron opgegeven');

  // R-rekenwerk: +2R en -1R ⇒ 50% trefkans, +0,5R verwachting.
  assert.equal(r.paper.closed, 2);
  assert.equal(r.paper.winRate, 0.5);
  assert.equal(r.paper.bestR, 2);
  assert.equal(r.paper.worstR, -1);
  assert.equal(r.paper.expectancyR, 0.5);
  assert.equal(r.paper.pnl, 200);

  // De waarschuwing zit in de data, niet alleen in de begeleidende tekst.
  assert.ok(r.caveats.some((c) => /slippage/i.test(c)));
  assert.ok(r.caveats.some((c) => /bovengrens/i.test(c)));

  // Drempels: met twee trades hoort dit nadrukkelijk nog niet groen te staan.
  const closedCheck = r.readiness.find((c) => c.criterion.includes('afgeronde papieren trades'))!;
  assert.equal(closedCheck.met, false);
  // 'wacht' alleen zou ook "verwachtingswaarde" raken — matchen op de hele zin.
  assert.equal(r.readiness.find((c) => c.criterion.includes('akkoord wachten'))!.met, false);
  assert.equal(r.readiness.find((c) => c.criterion.includes('verwachtingswaarde'))!.met, true);

  // Herhaalpoging: afgewezen en binnen het uur hetzelfde opnieuw.
  const retryIntents = [
    mk({ createdAt: now - 2 * 60 * 60 * 1000, status: 'rejected', blockedBy: ['risico per trade'] }),
    mk({ createdAt: now - 2 * 60 * 60 * 1000 + 15 * 60_000, status: 'paper-filled' }),
  ];
  const retried = buildTradeReview(retryIntents, [], 7, now);
  assert.equal(retried.retries.length, 1);
  assert.equal(retried.retries[0]!.minutes, 15);
  assert.equal(retried.readiness.find((c) => c.criterion.includes('herhaalpogingen'))!.met, false);

  // Ver buiten het herhaalvenster telt niet als herhaalpoging.
  const later = buildTradeReview(
    [
      mk({ createdAt: now - 5 * 60 * 60 * 1000, status: 'rejected', blockedBy: ['risico per trade'] }),
      mk({ createdAt: now - 5 * 60 * 60 * 1000 + (REVIEW_THRESHOLDS.retryWindowMin + 30) * 60_000 }),
    ],
    [],
    7,
    now,
  );
  assert.equal(later.retries.length, 0);
});
