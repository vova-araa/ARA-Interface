import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProjectPulse } from '@ara/shared';
import { loadProjects } from './projects.ts';

const run = promisify(execFile);

/**
 * Gemeten projectcijfers — de tegenhanger van de ingevulde kantoorcijfers.
 *
 * Alles hier komt uit iets dat echt bestaat: git leest de repo op schijf,
 * het bord telt taken, de usage-tabel telt tokens. Kan iets niet gemeten
 * worden (geen pad in projects.json, geen git-repo), dan ontbreekt het veld
 * gewoon. Er wordt hier nóóit iets ingevuld — dat is het hele punt.
 *
 * Git-aanroepen worden gecached: een kantoor dat elke paar seconden ververst
 * mag geen `git log` per verzoek afvuren.
 */
const CACHE_TTL_MS = 60_000;
const GIT_TIMEOUT_MS = 4000;

interface GitFacts {
  branch?: string;
  commitsToday?: number;
  commits7d?: number;
  lastCommitAt?: number;
  lastCommitSubject?: string;
  dirtyFiles?: number;
}

const cache = new Map<string, { at: number; facts: GitFacts }>();

function repoPathFor(project: string): string | null {
  const entry = loadProjects().find((p) => p.name === project);
  if (!entry?.path) return null;
  const dir = entry.path.replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
  try {
    // Alleen een echte git-repo; een losse map levert niets op.
    return fs.existsSync(path.join(dir, '.git')) ? dir : null;
  } catch {
    return null;
  }
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function gitFacts(dir: string): Promise<GitFacts> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const since = midnight.toISOString();

  const [branch, today, week, last, status] = await Promise.all([
    git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(dir, ['rev-list', '--count', `--since=${since}`, 'HEAD']),
    git(dir, ['rev-list', '--count', '--since=7.days', 'HEAD']),
    git(dir, ['log', '-1', '--format=%ct%n%s']),
    git(dir, ['status', '--porcelain']),
  ]);

  const facts: GitFacts = {};
  if (branch) facts.branch = branch;
  if (today !== undefined && /^\d+$/.test(today)) facts.commitsToday = Number(today);
  if (week !== undefined && /^\d+$/.test(week)) facts.commits7d = Number(week);
  if (last) {
    const [epoch, ...subject] = last.split('\n');
    if (epoch && /^\d+$/.test(epoch)) facts.lastCommitAt = Number(epoch) * 1000;
    if (subject.length) facts.lastCommitSubject = subject.join(' ').slice(0, 120);
  }
  // Een lege status is 0 gewijzigde bestanden — dat is een meting, geen gat.
  if (status !== undefined) {
    facts.dirtyFiles = status === '' ? 0 : status.split('\n').length;
  }
  return facts;
}

export interface PulseCounts {
  toolCallsToday?: number;
  errorsToday?: number;
  tokensToday?: number;
  openTasks?: number;
  doneTasksToday?: number;
}

/**
 * Bouwt de meetlaag voor één project. `counts` komt uit de collector zelf
 * (WorldState, bord, usage-tabel); git komt van schijf en wordt gecached.
 */
export async function projectPulse(project: string, counts: PulseCounts): Promise<ProjectPulse> {
  const now = Date.now();
  let facts: GitFacts = {};
  const dir = repoPathFor(project);
  if (dir) {
    const hit = cache.get(dir);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      facts = hit.facts;
    } else {
      facts = await gitFacts(dir);
      cache.set(dir, { at: now, facts });
    }
  }
  return { ...facts, ...counts, measuredAt: now };
}
