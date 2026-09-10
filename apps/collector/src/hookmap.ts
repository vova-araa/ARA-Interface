/**
 * Maps raw Claude Code hook payloads (POST /hook/:name from emit.sh) to
 * AraEvents. Keeping this in the collector keeps emit.sh dumb (<20ms path).
 */
import path from 'node:path';
import { redactString } from '@ara/shared';
import type { AraEventKind, IncomingEvent } from '@ara/shared';

export interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  agent_id?: string;
  agent_type?: string;
  subagent_type?: string;
  parent_agent_id?: string;
  prompt?: string;
  message?: string;
  notification?: string;
  reason?: string;
  [key: string]: unknown;
}

const HOOK_TO_KIND: Record<string, AraEventKind> = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool.pre',
  PostToolUse: 'tool.post',
  PostToolUseFailure: 'tool.post', // status wordt 'error' + tool_error in de summary
  SubagentStart: 'agent.start',
  SubagentStop: 'agent.stop',
  Stop: 'stop',
  Notification: 'notification',
  TaskCompleted: 'task.completed',
  TeammateIdle: 'teammate.idle',
  PermissionRequest: 'permission.ask',
  PermissionDenied: 'permission.deny',
  PreCompact: 'compact.start',
  PostCompact: 'compact.end',
  PostModelSwitch: 'model.switch',
  PostToolBatch: 'tool.batch',
  WorktreeCreate: 'worktree.start',
  WorktreeRemove: 'worktree.stop',
  TaskCreated: 'task.created',
};

export function toolSummary(tool: string | undefined, input: Record<string, unknown> | undefined): string | undefined {
  if (!tool || !input) return undefined;
  // Redactie vóór het knippen: een op 60 tekens afgeknipte Bearer-token zou
  // anders te kort zijn voor de redactiepatronen en alsnog doorlekken.
  const clip = (s: unknown, n = 60): string =>
    redactString(String(s ?? '').replace(/\s+/g, ' ')).slice(0, n);
  const base = (p: unknown): string => (typeof p === 'string' ? path.basename(p) : '');
  switch (tool) {
    case 'Bash':
      return clip(input.command);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return clip(`${tool} ${base(input.file_path ?? input.notebook_path)}`);
    case 'Grep':
      return clip(`grep ${String(input.pattern ?? '')}`);
    case 'Glob':
      return clip(`glob ${String(input.pattern ?? '')}`);
    case 'WebSearch':
    case 'WebFetch':
      return clip(String(input.query ?? input.url ?? ''));
    case 'Task':
    case 'Agent':
      return clip(String(input.description ?? input.prompt ?? ''));
    default:
      if (tool.startsWith('mcp__')) return clip(tool.replace(/^mcp__/, '').replace(/__/g, ' '));
      return clip(tool);
  }
}

export function mapHookPayload(hookName: string, payload: HookPayload): IncomingEvent | null {
  const kind = HOOK_TO_KIND[hookName] ?? HOOK_TO_KIND[payload.hook_event_name ?? ''];
  if (!kind) return null;

  const responseIsError = (() => {
    const r = payload.tool_response;
    if (!r || typeof r !== 'object') return false;
    const obj = r as Record<string, unknown>;
    return obj.is_error === true || typeof obj.error === 'string';
  })();

  const event: IncomingEvent = {
    kind,
    sessionId: payload.session_id ?? 'unknown-session',
    cwd: payload.cwd ?? '',
    tool: payload.tool_name,
    toolInput: payload.tool_input,
    toolSummary: toolSummary(payload.tool_name, payload.tool_input),
    agentId: payload.agent_id ?? (kind.startsWith('agent.') ? payload.tool_use_id : undefined),
    agentType: payload.agent_type ?? payload.subagent_type,
    parentAgentId: payload.parent_agent_id,
  };

  // Cap vóór schema-validatie: een prompt >500 tekens mag het hele event niet
  // laten afkeuren (de pod bleef dan op 'idle' hangen).
  if (kind === 'prompt') event.message = payload.prompt?.slice(0, 500);
  if (kind === 'notification') {
    event.message = payload.message ?? payload.notification;
    event.needsHuman = true;
  }
  if (kind === 'tool.post') {
    if (hookName === 'PostToolUseFailure') {
      event.status = 'error';
      const err = typeof payload.tool_error === 'string' ? payload.tool_error : '';
      if (err) event.toolSummary = redactString(err.replace(/\s+/g, ' ')).slice(0, 200);
    } else {
      event.status = responseIsError ? 'error' : 'ok';
    }
  }
  if (kind === 'session.end') event.message = payload.reason;
  if (kind === 'session.start' && typeof payload.model === 'string') event.model = payload.model;
  if (kind === 'permission.ask' || kind === 'permission.deny') {
    event.message = `permissie: ${payload.tool_name ?? 'tool'}`;
  }
  if (kind === 'model.switch') {
    const from = typeof payload.from_model === 'string' ? payload.from_model : '?';
    const to = typeof payload.to_model === 'string' ? payload.to_model : '?';
    event.model = to === '?' ? undefined : to;
    event.message = `${from} → ${to}`;
  }
  if (kind === 'tool.batch') {
    const n = Array.isArray(payload.batch_results) ? payload.batch_results.length : 0;
    event.message = `${n || '?'} tools parallel`;
  }
  if (kind === 'worktree.start' || kind === 'worktree.stop') {
    const p = typeof payload.worktree_path === 'string' ? payload.worktree_path : '';
    if (p) event.message = `worktree ${path.basename(p)}`;
  }
  if (kind === 'task.created') {
    const desc = typeof payload.task_description === 'string' ? payload.task_description : '';
    event.message = desc.slice(0, 500) || 'nieuwe taak';
  }
  return event;
}
