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

test('buildOffice: echte data van agents wint van ingevulde cijfers', async () => {
  const { buildOffice } = await import('./office.ts');
  const { VENTURES } = await import('./world.ts');
  const office = buildOffice({
    project: 'crypto-desk',
    venture: VENTURES.find((v) => v.id === 'crypto')!,
    sessions: [],
    tasks: [],
    overrides: [{ id: 'BTC', status: 'alert', value: 123.45, sub: '9 setups' }],
    now: Date.now(),
  });
  assert.equal(office.simulated, false, 'met echte data vervalt de voorbeeld-markering');
  const btc = office.stations.find((s) => s.id === 'BTC')!;
  assert.equal(btc.status, 'alert');
  assert.equal(btc.value, 123.45);
  assert.equal(btc.sub, '9 setups');
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
