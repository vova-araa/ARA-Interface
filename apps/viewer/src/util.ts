export function ageString(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export const STATUS_COLORS: Record<string, string> = {
  idle: '#8b95a5',
  working: '#4da3ff',
  needsHuman: '#ffb020',
  done: '#3ecf6f',
  error: '#ff5252',
};

export const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '🔨',
  Write: '🔨',
  NotebookEdit: '🔨',
  Bash: '🔧',
  Grep: '🔍',
  Glob: '🔍',
  WebSearch: '🔭',
  WebFetch: '🔭',
  Task: '📣',
  Agent: '📣',
};

export function toolIcon(tool: string | undefined): string {
  if (!tool) return '⚙️';
  if (tool.startsWith('mcp__')) return '🔌';
  return TOOL_ICONS[tool] ?? '⚙️';
}

/** Tool color used for pod inner-light pulses. */
export const TOOL_COLORS: Record<string, string> = {
  Read: '#4da3ff',
  Edit: '#ff8a3d',
  Write: '#ff8a3d',
  Bash: '#3ecf6f',
  Grep: '#c07cff',
  Glob: '#c07cff',
  WebSearch: '#4dd7ff',
  WebFetch: '#4dd7ff',
  Task: '#ffd75e',
};

export function toolColor(tool: string | undefined): string {
  if (!tool) return '#4da3ff';
  if (tool.startsWith('mcp__')) return '#ff6b9e';
  return TOOL_COLORS[tool] ?? '#4da3ff';
}
