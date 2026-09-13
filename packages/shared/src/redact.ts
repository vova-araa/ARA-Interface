/**
 * Redaction of secrets before anything is stored or streamed.
 * Applied by the collector to every incoming event.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g, // OpenAI/Anthropic style keys
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
];

export function redactString(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

/** Deep-redacts strings in an arbitrary JSON value. Depth-limited to keep it O(small). */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|credential|authorization/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Cap free-text fields; never store more than 200 chars of prompt-like content. */
export function capText(text: string | undefined, max = 200): string | undefined {
  if (text === undefined) return undefined;
  const clean = redactString(text);
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

/**
 * Kapt een (al geredigeerde) tool-invoer af op grootte. Zonder dit belandt de
 * volledige inhoud van elke Write/Edit in SQLite én in de SSE-stroom naar elke
 * kijker — inclusief klantdata en secrets die geen enkel patroon matchen.
 * De vorm blijft herkenbaar: je ziet dát er iets was en hoe groot.
 */
export function capValue(value: unknown, maxChars = 2000): unknown {
  if (value === undefined || value === null) return value;
  let json: string;
  try {
    json = JSON.stringify(value) ?? '';
  } catch {
    return { truncated: true, reason: 'niet serialiseerbaar' };
  }
  if (json.length <= maxChars) return value;
  return {
    truncated: true,
    chars: json.length,
    preview: json.slice(0, Math.min(400, maxChars)),
  };
}
