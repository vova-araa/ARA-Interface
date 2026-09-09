/**
 * Maps raw Claude Code hook payloads (POST /hook/:name from emit.sh) to
 * AraEvents. Keeping this in the collector keeps emit.sh dumb (<20ms path).
 */
import path from 'node:path';
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
  SubagentStart: 'agent.start',
  SubagentStop: 'agent.stop',
  Stop: 'stop',
  Notification: 'notification',
  TaskCompleted: 'task.completed',
  TeammateIdle: 'teammate.idle',
};

export function toolSummary(tool: string | undefined, input: Record<string, unknown> | undefined): string | undefined {
  if (!tool || !input) return undefined;
  const clip = (s: unknown, n = 60): string => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
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

  if (kind === 'prompt') event.message = payload.prompt;
  if (kind === 'notification') {
    event.message = payload.message ?? payload.notification;
    event.needsHuman = true;
  }
  if (kind === 'tool.post') event.status = responseIsError ? 'error' : 'ok';
  if (kind === 'session.end') event.message = payload.reason;
  return event;
}
