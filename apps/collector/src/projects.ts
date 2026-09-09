import fs from 'node:fs';
import path from 'node:path';
import { buildWorldConfig, type ProjectEntry, type WorldConfig } from '@ara/shared';
import { PROJECTS_JSON_PATH, WORLD_CONFIG_PATH } from './config.ts';

/**
 * projects.json (dev-project-manager skill) is the source of truth for the
 * project list. Shape is tolerant: we accept {projects:[...]} or a bare array,
 * entries as strings or {name, path, repo, venture}.
 */
export function loadProjects(): ProjectEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(PROJECTS_JSON_PATH, 'utf8')) as unknown;
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { projects?: unknown[] }).projects)
        ? (raw as { projects: unknown[] }).projects
        : [];
    return list
      .map((entry): ProjectEntry | null => {
        if (typeof entry === 'string') return { name: entry };
        if (entry && typeof entry === 'object') {
          const e = entry as Record<string, unknown>;
          const name = (e.name ?? e.repo ?? e.id) as string | undefined;
          if (!name) return null;
          return {
            name: String(name),
            repo: e.repo ? String(e.repo) : undefined,
            path: e.path ? String(e.path) : undefined,
            venture: e.venture ? String(e.venture) : undefined,
          };
        }
        return null;
      })
      .filter((entry): entry is ProjectEntry => entry !== null);
  } catch {
    return [];
  }
}

let cachedProjects: ProjectEntry[] | null = null;

export function projectForCwd(cwd: string): string {
  if (!cwd) return 'unknown';
  cachedProjects ??= loadProjects();
  const normalized = cwd.replace(/\/+$/, '');
  // 1. Exact/subdirectory match on configured paths.
  for (const project of cachedProjects) {
    if (project.path) {
      const projectPath = project.path.replace(/\/+$/, '');
      if (normalized === projectPath || normalized.startsWith(projectPath + path.sep)) {
        return project.name;
      }
    }
  }
  // 2. Directory basename matches a project name.
  const base = path.basename(normalized).toLowerCase();
  for (const project of cachedProjects) {
    if (project.name.toLowerCase() === base) return project.name;
  }
  // 3. Fall back to the directory basename → lands in Nor Kaghak.
  return base || 'unknown';
}

export function loadOrBuildWorldConfig(): WorldConfig {
  try {
    return JSON.parse(fs.readFileSync(WORLD_CONFIG_PATH, 'utf8')) as WorldConfig;
  } catch {
    const config = buildWorldConfig(loadProjects());
    try {
      fs.writeFileSync(WORLD_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch {
      // read-only fs is fine; serve from memory
    }
    return config;
  }
}

export function refreshProjects(): void {
  cachedProjects = null;
}
