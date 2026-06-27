/**
 * Post-turn memory extraction.
 *
 * Two strategies, both producing a `{ upserts, deletes }` delta:
 *   1. LLM extraction (recommended) — `generateObject` against a cheap/fast
 *      model with a structured schema; can add new facts AND supersede stale
 *      ones. The system prompt forbids storing secrets/credentials/unvolunteered
 *      PII.
 *   2. Heuristic (fallback, no extra model call) — a small rule set that
 *      captures explicit imperative preferences ("always…", "I prefer…",
 *      "call me…", "remember that…") and stores them verbatim.
 *
 * Either way the output runs a redaction pass that drops obvious secret patterns
 * before persistence.
 */

import 'server-only';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';

export interface MemoryDelta {
  upserts: { text: string; kind: string }[];
  deletes: string[];
}

/** Structured-output schema for LLM extraction (add facts + supersede stale). */
const MemoryDeltaSchema = z.object({
  upserts: z.array(
    z.object({
      text: z.string().max(280),
      kind: z.enum(['preference', 'fact', 'goal', 'context', 'instruction']),
    }),
  ),
  deletes: z.array(z.string()).describe('ids of now-stale memories to remove'),
});

const EXTRACTION_SYSTEM_PROMPT = [
  'You extract durable, salient facts about the USER from a conversation turn.',
  'Output self-contained, first-person-about-the-user statements (e.g. "Prefers',
  'TypeScript", "Is migrating off Firebase"). Prefer UPDATING or SUPERSEDING',
  'existing facts over duplicating them: if a new statement makes an existing',
  'memory stale, add the new fact AND list the stale memory id in `deletes`.',
  'NEVER store secrets, credentials, API keys, tokens, passwords, or PII the',
  'user did not volunteer as a durable preference. Ignore ephemeral chit-chat',
  'and one-off task details. If nothing is worth keeping, return empty arrays.',
  'Each fact <= 280 chars. Allowed kinds: preference, fact, goal, context, instruction.',
].join(' ');

/** Obvious secret patterns to strip before persistence (defence in depth). */
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, // OpenAI-style keys
  /\b[A-Za-z0-9_-]*[Aa][Pp][Ii][_-]?[Kk][Ee][Yy][:=]\s*\S+/g, // api_key=...
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, // bearer tokens
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex blobs (hashes/keys)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
];

/** True if a string smells like it contains a secret (drop it entirely). */
function looksSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** Drop any upsert that looks like it carries a secret. */
export function redactDelta(delta: MemoryDelta): MemoryDelta {
  return {
    upserts: delta.upserts.filter((u) => u.text.trim().length > 0 && !looksSecret(u.text)),
    deletes: delta.deletes,
  };
}

/** Flatten a UI/Model message's text parts for the extraction prompt. */
export function renderTurn(messages: unknown[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const msg = m as { role?: string; parts?: Array<{ type?: string; text?: string }>; content?: unknown };
    const role = msg.role ?? 'user';
    let text = '';
    if (Array.isArray(msg.parts)) {
      text = msg.parts
        .filter((p) => p?.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
    } else if (typeof msg.content === 'string') {
      text = msg.content;
    }
    if (text.trim()) lines.push(`${role.toUpperCase()}: ${text.trim()}`);
  }
  return lines.join('\n');
}

/** LLM extraction via `generateObject`. Returns an empty delta on any failure. */
export async function llmExtract(
  model: LanguageModel,
  turnText: string,
  existing: { id: string; text: string }[],
): Promise<MemoryDelta> {
  const existingBlock = existing.length
    ? existing.map((e) => `- [${e.id}] ${e.text}`).join('\n')
    : '(none)';
  const prompt = [
    'Existing memories for this user:',
    existingBlock,
    '',
    'Conversation turn:',
    turnText,
    '',
    'Extract durable facts about the user. Return JSON only.',
  ].join('\n');

  try {
    const { object } = await generateObject({
      model,
      schema: MemoryDeltaSchema,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt,
    });
    return {
      upserts: Array.isArray(object.upserts) ? object.upserts.slice(0, 20) : [],
      deletes: Array.isArray(object.deletes) ? object.deletes.slice(0, 20) : [],
    };
  } catch {
    return { upserts: [], deletes: [] };
  }
}

/**
 * Heuristic extraction — zero extra model call. Captures explicit imperative
 * preferences the user states. Lower recall, no cost/latency.
 */
export function heuristicExtract(turnText: string): MemoryDelta {
  const upserts: { text: string; kind: string }[] = [];
  // Only mine USER lines.
  const userLines = turnText
    .split('\n')
    .filter((l) => l.startsWith('USER:'))
    .map((l) => l.slice('USER:'.length).trim());

  const triggers: Array<{ re: RegExp; kind: string }> = [
    { re: /\b(i prefer|i'd prefer|i like|i love|i hate|i dislike)\b/i, kind: 'preference' },
    { re: /\b(always|never|in future|from now on|going forward)\b/i, kind: 'instruction' },
    { re: /\b(call me|my name is|i am called)\b/i, kind: 'fact' },
    { re: /\b(remember that|note that|keep in mind|fyi)\b/i, kind: 'context' },
    { re: /\b(i'm building|i am building|i'm working on|my goal is|i want to)\b/i, kind: 'goal' },
  ];

  for (const line of userLines) {
    // Consider sentence-level fragments so one long line yields tight facts.
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length < 4 || s.length > 280) continue;
      const hit = triggers.find((t) => t.re.test(s));
      if (hit) upserts.push({ text: s.replace(/\s+/g, ' '), kind: hit.kind });
    }
  }
  // De-dupe by text.
  const seen = new Set<string>();
  return {
    upserts: upserts.filter((u) => (seen.has(u.text) ? false : (seen.add(u.text), true))).slice(0, 10),
    deletes: [],
  };
}
