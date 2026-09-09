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

test('placementForProject invents a stable slot for unknown projects', () => {
  const config = buildWorldConfig([{ name: 'traject-tms' }], 123);
  const p1 = placementForProject(config, 'brand-new');
  const p2 = placementForProject(config, 'brand-new');
  assert.deepEqual(p1.center, p2.center);
  assert.equal(p1.venture, 'misc');
});
