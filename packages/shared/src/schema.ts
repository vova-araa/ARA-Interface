import { z } from 'zod';

export const EVENT_KINDS = [
  'session.start',
  'session.end',
  'prompt',
  'tool.pre',
  'tool.post',
  'agent.start',
  'agent.stop',
  'stop',
  'notification',
  'task.completed',
  'teammate.idle',
  // Uitgebreide hook-dekking (upgrade-batch): permissies, compaction,
  // model-switches, parallelle tool-batches, worktrees en taak-creatie.
  'permission.ask',
  'permission.deny',
  'compact.start',
  'compact.end',
  'model.switch',
  'tool.batch',
  'worktree.start',
  'worktree.stop',
  'task.created',
] as const;

export type AraEventKind = (typeof EVENT_KINDS)[number];

export const AraEventSchema = z.object({
  id: z.string().min(1),
  ts: z.number().int().positive(),
  kind: z.enum(EVENT_KINDS),
  sessionId: z.string().min(1),
  agentId: z.string().optional(),
  agentType: z.string().optional(),
  parentAgentId: z.string().optional(),
  cwd: z.string().default(''),
  project: z.string().default('unknown'),
  tool: z.string().optional(),
  toolInput: z.unknown().optional(),
  toolSummary: z.string().max(200).optional(),
  status: z.enum(['ok', 'error', 'blocked']).optional(),
  durationMs: z.number().nonnegative().optional(),
  needsHuman: z.boolean().optional(),
  message: z.string().max(500).optional(),
  /** Actief model (SessionStart / model.switch): drijft de pod-gedaante. */
  model: z.string().max(100).optional(),
});

export type AraEvent = z.infer<typeof AraEventSchema>;

/** Incoming events from hooks may omit id/ts/project — collector fills them in. */
export const IncomingEventSchema = AraEventSchema.partial({ id: true, ts: true }).extend({
  project: z.string().optional(),
});
export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

export type PodStatus = 'idle' | 'working' | 'needsHuman' | 'done' | 'error';

export interface AgentState {
  agentId: string;
  agentType?: string;
  parentAgentId?: string;
  sessionId: string;
  startedAt: number;
  lastSeenAt: number;
  activeTool?: string;
  lastToolSummary?: string;
  stopped: boolean;
}

export interface SessionState {
  sessionId: string;
  project: string;
  cwd: string;
  startedAt: number;
  lastSeenAt: number;
  endedAt?: number;
  status: PodStatus;
  activeTool?: string;
  lastTool?: string;
  lastToolSummary?: string;
  needsHuman: boolean;
  message?: string;
  toolCount: number;
  errorCount: number;
  agents: Record<string, AgentState>;
  /** Laatst bekende model — bepaalt de pod-gedaante (haiku klein, opus/fable groot). */
  model?: string;
  /** True tussen compact.start en compact.end (context-storm animatie). */
  compacting?: boolean;
  /** Aantal actieve worktrees (drijvend eilandje naast de pod). */
  worktrees?: number;
}

export interface WorldSnapshot {
  now: number;
  sessions: Record<string, SessionState>;
  /** Projects seen in the event stream (may include ones not in world.config.json). */
  projects: string[];
  /** Rolling counters for the top bar. doneSessions maakt hydrate verliesvrij. */
  counters: { needsHuman: number; running: number; doneToday: number; doneSessions?: string[] };
}
