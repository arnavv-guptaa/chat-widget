import type { ToolPart, ToolStatus, TurnState } from './types';

export const SUBTITLE_MAX = 44;

export function truncate(s: string, n = SUBTITLE_MAX): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Turn a tool slug into friendly running / done verbs for an ASSISTANT voice.
 * "getUserPortfolios" → running "Looking up your portfolios" / done "Pulled up
 * your portfolios". We keep this generic (no host-specific table) by parsing
 * the common verb prefixes assistants' tools use, then humanizing the rest.
 */
const VERB_PREFIXES: Array<{ re: RegExp; running: string; done: string }> = [
  { re: /^(get|fetch|load|list|read|retrieve)/i, running: 'Looking up', done: 'Pulled up' },
  { re: /^(search|find|lookup|query)/i, running: 'Searching', done: 'Searched' },
  { re: /^(analy[sz]e|assess|evaluate|review)/i, running: 'Analyzing', done: 'Analyzed' },
  { re: /^(calculate|compute|run)/i, running: 'Working out', done: 'Worked out' },
  { re: /^(create|add|build|generate|make)/i, running: 'Putting together', done: 'Put together' },
  { re: /^(update|edit|modify|set|save)/i, running: 'Updating', done: 'Updated' },
  { re: /^(delete|remove)/i, running: 'Removing', done: 'Removed' },
];

const KNOWN: Record<string, { running: string; done: string }> = {
  web_search: { running: 'Searching the web', done: 'Searched the web' },
  web_search_preview: { running: 'Searching the web', done: 'Searched the web' },
  code_execution: { running: 'Running the numbers', done: 'Ran the numbers' },
};

/** "getUserPortfolios" → "user portfolios" ; "get_financials" → "financials". */
function humanizeObject(slug: string): string {
  let s = slug
    .replace(/^(get|fetch|load|list|read|retrieve|search|find|lookup|query|analy[sz]e|assess|evaluate|review|calculate|compute|run|create|add|build|generate|make|update|edit|modify|set|save|delete|remove)/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  // Drop a leading possessive-ish word duplication; keep it simple.
  return s;
}

function titleCase(slug: string): string {
  const cleaned = slug.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (!cleaned) return 'that';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function getToolVerb(tool: string, isPending: boolean): string {
  const known = KNOWN[tool];
  if (known) return isPending ? known.running : known.done;

  for (const p of VERB_PREFIXES) {
    if (p.re.test(tool)) {
      const obj = humanizeObject(tool);
      const verb = isPending ? p.running : p.done;
      return obj ? `${verb} ${obj}` : verb;
    }
  }
  // Unknown shape → neutral, still friendly.
  return isPending ? `Working on ${titleCase(tool).toLowerCase()}` : titleCase(tool);
}

/** A one-line subtitle from the input — the most salient string/number arg. */
export function getToolSubtitle(part: ToolPart): string {
  const input = part.state.input;
  // Prefer obviously-identifying keys first.
  const PREFERRED = ['symbol', 'ticker', 'name', 'query', 'q', 'portfolioId', 'id', 'filePath', 'path'];
  for (const k of PREFERRED) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) {
      return truncate(k === 'filePath' || k === 'path' ? v.split('/').pop() || v : v);
    }
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) return truncate(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return '';
}

/**
 * A short result summary from the output, in assistant voice — e.g. an array of
 * N → "13 results", an object with a count, a short string echoed. Returns ''
 * when nothing meaningful can be summarized (the row just reads as done).
 */
export function getResultSummary(part: ToolPart): string {
  const out = part.state.output;
  if (out == null) return '';
  if (Array.isArray(out)) {
    return `${out.length} ${out.length === 1 ? 'result' : 'results'}`;
  }
  if (typeof out === 'string') {
    const t = out.trim();
    if (!t) return '';
    return t.length > SUBTITLE_MAX ? truncate(t) : t;
  }
  if (typeof out === 'object') {
    const o = out as Record<string, unknown>;
    // Common count-ish keys.
    for (const k of ['count', 'total', 'length']) {
      if (typeof o[k] === 'number') return `${o[k]} ${(o[k] as number) === 1 ? 'item' : 'items'}`;
    }
    // An array nested one level (e.g. { portfolios: [...] }).
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'result' : 'results'}`;
    }
  }
  return '';
}

export function getToolStatus(part: ToolPart, turn: TurnState): ToolStatus {
  const status = part.state.status;
  const turnAlive = turn !== 'done' && turn !== 'error';
  const isError = status === 'output-error';
  const isSuccess = status === 'output-available';
  const stillRunning = status === 'input-streaming' || status === 'input-available';
  const isPending = stillRunning && turnAlive;
  const isInterrupted = stillRunning && !turnAlive;
  return { isPending, isError, isSuccess, isInterrupted };
}

/** Planning verbs for the gap before the first token — warm, assistant-y. */
export const PLANNING_VERBS = [
  'Thinking it through',
  'One moment',
  'Looking into it',
  'Working on it',
  'Putting it together',
  'Getting that for you',
  'On it',
] as const;

export function pickPlanningVerb(messageId: string): string {
  let h = 0;
  for (let i = 0; i < messageId.length; i++) h = h * 31 + messageId.charCodeAt(i);
  return PLANNING_VERBS[Math.abs(h) % PLANNING_VERBS.length];
}
