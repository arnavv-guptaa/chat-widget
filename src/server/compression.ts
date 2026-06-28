/**
 * Headroom token compression — an optional, toggle-on context compressor.
 *
 * WHAT THIS IS
 * ------------
 * A drop-in, opt-in layer that shrinks the model-bound payload — large tool
 * outputs, pasted blobs, RAG chunks, long history — right before `streamText`,
 * using a running Headroom service (https://github.com/headroomlabs-ai/headroom).
 * Headroom routes each blob to the right compressor (SmartCrusher for JSON,
 * CodeCompressor for source, Kompress for prose) and reports the tokens saved.
 *
 * WHY IT LIVES HERE (and how it stays safe)
 * -----------------------------------------
 * `createChatHandler` already has one place where the final, model-ready
 * `ModelMessage[]` exists immediately before the model call. We compress there.
 * Two hard rules, both matching the rest of this package's philosophy:
 *
 *   1. It is OFF unless explicitly enabled — a feature you toggle on.
 *   2. It can NEVER break a turn. Every failure path — disabled, endpoint
 *      unreachable, timeout, malformed response, structure mismatch — falls
 *      through to the ORIGINAL messages, uncompressed. Compression is a cost
 *      optimisation, not a correctness dependency. This mirrors how
 *      `getHostedConfig` is treated: a control-plane hiccup never breaks a turn.
 *
 * HOW IT COMPRESSES (structure-preserving "slot" model)
 * -----------------------------------------------------
 * We deliberately do NOT round-trip the whole conversation through a lossy
 * format conversion (which would strip tool names, image parts, reasoning, and
 * message ordering). Instead we extract only the large *string payloads* —
 * system/user/assistant text and tool-result outputs — as a flat batch,
 * compress that batch in a single call, and write each compressed string back
 * into its exact original slot. Message and part STRUCTURE is never altered:
 * tool calls, tool-call ids, tool names, image/file parts, reasoning and
 * ordering are preserved. Only opaque text payloads change. If the service
 * returns a batch that does not line up 1:1 with what we sent, we discard it
 * and use the originals — correctness over savings, every time.
 *
 * NO NEW DEPENDENCIES
 * -------------------
 * This talks to the Headroom HTTP endpoint with the global `fetch` already used
 * throughout the handler — the `headroom-ai` package is NOT required. If you'd
 * rather use that package (or any other compressor), pass a `compress` function
 * in the config and we call that instead.
 */

import type { ModelMessage } from 'ai';
import type { ChatRequestContext } from './handler-types';

// ── Public configuration & result types ─────────────────────────────────────

/**
 * Declarative configuration for Headroom token compression. Every field is
 * optional; the only thing you must do to turn it on is set `enabled: true`
 * (or pass `compression: true`, which is sugar for `{ enabled: true }`).
 */
export interface CompressionConfig {
  /** Master switch. Compression is OFF unless this is `true`. */
  enabled?: boolean;

  /**
   * Base URL of your Headroom compress endpoint (the proxy/service exposing
   * `POST /v1/compress`). Defaults to `process.env.HEADROOM_BASE_URL`, then
   * `http://localhost:8787` (the Headroom proxy default). If nothing is
   * reachable there, compression is a silent no-op and the turn proceeds
   * uncompressed.
   */
  baseUrl?: string;

  /**
   * Optional bearer token for a secured Headroom deployment. Sent as
   * `Authorization: Bearer …`. Defaults to `process.env.HEADROOM_API_KEY`.
   */
  apiKey?: string;

  /**
   * Model hint forwarded to Headroom so it can pick the right tokenizer/route.
   * Defaults to the model label the handler is about to stream from.
   */
  model?: string;

  /**
   * Per-request timeout in milliseconds. Compression sits on the hot path, so
   * this is deliberately short — on timeout we pass the original messages
   * straight through. Defaults to 5000ms.
   */
  timeoutMs?: number;

  /**
   * Skip the round-trip entirely unless the combined size of compressible
   * payloads reaches this many characters (~4 chars/token). Avoids paying
   * network latency to shave a few tokens off a tiny prompt. Defaults to 2000.
   */
  minChars?: number;

  /**
   * Optional hard token budget. When set, Headroom compacts to fit within it
   * (more aggressive). Omit for lossless-leaning per-content compression.
   */
  tokenBudget?: number;

  /**
   * Observability hook, called once per turn with the compression outcome
   * (tokens saved, ratio, transforms, CCR hashes, or the skip reason). Errors
   * thrown here are caught and logged — they never affect the response.
   */
  onResult?: (result: CompressionResult, ctx: ChatRequestContext) => void;

  /**
   * Escape hatch: bring your own compressor. When provided, it is called
   * instead of the built-in Headroom HTTP client — pass `headroom-ai`'s
   * `compress`, or any function that returns compressed `ModelMessage[]`. It
   * must be safe (return the input on failure); the handler still guards it.
   */
  compress?: (
    messages: ModelMessage[],
    ctx: ChatRequestContext,
  ) => ModelMessage[] | Promise<ModelMessage[]>;
}

/**
 * What you pass to `createChatHandler`'s `compression` option (and what the
 * hosted control plane may return): `true`/`false` for the simple on/off case,
 * or a {@link CompressionConfig} for full control.
 */
export type CompressionOption = boolean | CompressionConfig;

/** Why a compression attempt produced no change. Useful for telemetry. */
export type CompressionSkipReason =
  | 'disabled'
  | 'no-content'
  | 'below-threshold'
  | 'unreachable'
  | 'timeout'
  | 'bad-response'
  | 'structure-mismatch'
  | 'error';

/** The outcome of one compression attempt, surfaced via `onResult`. */
export interface CompressionResult {
  /** True only when at least one payload was actually shrunk. */
  compressed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  /** `tokensAfter / tokensBefore` (1 when nothing changed). */
  compressionRatio: number;
  /** Names of the Headroom transforms that ran (e.g. `SmartCrusher`). */
  transformsApplied: string[];
  /** CCR hashes for the originals, retrievable from the Headroom store. */
  ccrHashes: string[];
  /** Wall-clock time spent in the compression step. */
  elapsedMs: number;
  /** Present when `compressed` is false — why nothing changed. */
  skipReason?: CompressionSkipReason;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'http://localhost:8787';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MIN_CHARS = 2_000; // ~500 tokens; below this the round-trip isn't worth it
const MIN_SLOT_CHARS = 200; // don't bother sending tiny strings in the batch
/** Telemetry slug Headroom records as the calling integration. */
const HEADROOM_STACK = 'mordn_chat_widget';

// ── Config resolution (code > hosted > off) ─────────────────────────────────

/** Normalise a `boolean | CompressionConfig` into an enabled config, or null. */
export function normalizeCompression(
  option: CompressionOption | undefined,
): CompressionConfig | null {
  if (option === undefined || option === null) return null;
  if (option === true) return { enabled: true };
  if (option === false) return null;
  return option.enabled ? option : null;
}

/**
 * Resolve the effective compression config with the same precedence the
 * handler uses for `model` and the system prompt: **code > hosted > default**.
 *
 * An explicit code value wins outright — passing `compression: false` in code
 * disables it even if the dashboard turned it on. Hosted config is consulted
 * only when code says nothing (`undefined`).
 */
export function resolveCompression(
  code: CompressionOption | undefined,
  hosted: CompressionOption | undefined | null,
): CompressionConfig | null {
  if (code !== undefined) return normalizeCompression(code);
  return normalizeCompression(hosted ?? undefined);
}

// ── The compression step ────────────────────────────────────────────────────

/**
 * Compress the model-ready messages via Headroom. Never throws and never
 * returns malformed messages: on any failure it returns the input untouched
 * alongside a {@link CompressionResult} explaining why.
 *
 * @param messages   the final `ModelMessage[]` about to be streamed
 * @param config     a resolved, enabled {@link CompressionConfig}
 * @param ctx        the per-request context (passed to hooks)
 * @param modelLabel string label of the target model (tokenizer hint)
 */
export async function compressModelMessages(
  messages: ModelMessage[],
  config: CompressionConfig,
  ctx: ChatRequestContext,
  modelLabel?: string,
): Promise<{ messages: ModelMessage[]; result: CompressionResult }> {
  const start = Date.now();
  const skip = (skipReason: CompressionSkipReason): CompressionResult => ({
    compressed: false,
    tokensBefore: 0,
    tokensAfter: 0,
    tokensSaved: 0,
    compressionRatio: 1,
    transformsApplied: [],
    ccrHashes: [],
    elapsedMs: Date.now() - start,
    skipReason,
  });

  try {
    // Escape hatch: a caller-supplied compressor fully owns the transform.
    if (config.compress) {
      const out = await config.compress(messages, ctx);
      const safe = Array.isArray(out) && out.length > 0 ? out : messages;
      return {
        messages: safe,
        result: {
          compressed: safe !== messages,
          tokensBefore: 0,
          tokensAfter: 0,
          tokensSaved: 0,
          compressionRatio: 1,
          transformsApplied: ['custom'],
          ccrHashes: [],
          elapsedMs: Date.now() - start,
          ...(safe === messages ? { skipReason: 'no-content' as const } : {}),
        },
      };
    }

    // 1. Collect the large string payloads as compressible slots.
    const slots = collectSlots(messages);
    const candidates = slots.filter((s) => s.text.length >= MIN_SLOT_CHARS);
    if (candidates.length === 0) return { messages, result: skip('no-content') };

    const totalChars = candidates.reduce((n, s) => n + s.text.length, 0);
    const minChars = config.minChars ?? DEFAULT_MIN_CHARS;
    if (totalChars < minChars) return { messages, result: skip('below-threshold') };

    // 2. Compress the batch in one call. Each slot becomes a standalone user
    //    message; Headroom's ContentRouter still detects JSON/code/prose from
    //    the content itself, so the right compressor runs per slot.
    let resp: ProxyCompressResponse;
    try {
      resp = await callHeadroom(
        candidates.map((s) => ({ role: 'user' as const, content: s.text })),
        config,
        modelLabel,
      );
    } catch (err) {
      return { messages, result: skip(classifyError(err)) };
    }

    // 3. The batch must come back 1:1 (same length). Anything else means the
    //    service reshaped the payload in a way we can't safely map back.
    if (!resp || !Array.isArray(resp.messages) || resp.messages.length !== candidates.length) {
      return { messages, result: skip('structure-mismatch') };
    }

    // 4. Write each compressed string back into its original slot — but only
    //    when it is actually smaller, so a pathological expansion is a no-op.
    const out: ModelMessage[] = messages.map((m) => ({ ...m }) as ModelMessage);
    let applied = 0;
    candidates.forEach((slot, k) => {
      const compressed = extractText(resp.messages[k]);
      if (compressed && compressed.length < slot.text.length) {
        slot.apply(out, compressed);
        applied += 1;
      }
    });

    const tokensBefore = resp.tokens_before ?? 0;
    const tokensAfter = resp.tokens_after ?? 0;
    const result: CompressionResult = {
      compressed: applied > 0,
      tokensBefore,
      tokensAfter,
      tokensSaved: resp.tokens_saved ?? Math.max(0, tokensBefore - tokensAfter),
      compressionRatio: tokensBefore > 0 ? tokensAfter / tokensBefore : 1,
      transformsApplied: resp.transforms_applied ?? [],
      ccrHashes: resp.ccr_hashes ?? [],
      elapsedMs: Date.now() - start,
      ...(applied > 0 ? {} : { skipReason: 'below-threshold' as const }),
    };
    return { messages: applied > 0 ? out : messages, result };
  } catch {
    // Defensive belt-and-braces: nothing above should throw, but if it does the
    // turn must still go out uncompressed.
    return { messages, result: skip('error') };
  }
}

// ── Headroom HTTP client (dependency-free) ──────────────────────────────────

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/** The `/v1/compress` response shape (snake_case, as the proxy returns it). */
interface ProxyCompressResponse {
  messages: Array<{ role: string; content: unknown }>;
  tokens_before?: number;
  tokens_after?: number;
  tokens_saved?: number;
  compression_ratio?: number;
  transforms_applied?: string[];
  ccr_hashes?: string[];
}

class HeadroomHttpError extends Error {
  constructor(public status: number) {
    super(`Headroom responded ${status}`);
    this.name = 'HeadroomHttpError';
  }
}

function envVar(key: string): string | undefined {
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
}

async function callHeadroom(
  payload: OpenAIChatMessage[],
  config: CompressionConfig,
  modelLabel?: string,
): Promise<ProxyCompressResponse> {
  const baseUrl = (config.baseUrl ?? envVar('HEADROOM_BASE_URL') ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );
  const apiKey = config.apiKey ?? envVar('HEADROOM_API_KEY');
  const model = config.model ?? modelLabel ?? 'gpt-4o';

  const body: Record<string, unknown> = { messages: payload, model };
  if (config.tokenBudget) body.token_budget = config.tokenBudget;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Headroom-Stack': HEADROOM_STACK,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl}/v1/compress`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new HeadroomHttpError(response.status);
  return (await response.json()) as ProxyCompressResponse;
}

function classifyError(err: unknown): CompressionSkipReason {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (err instanceof HeadroomHttpError) return 'bad-response';
  return 'unreachable';
}

// ── Slot extraction & write-back ────────────────────────────────────────────

/**
 * A compressible string payload, plus a closure that writes a compressed
 * replacement back into a (cloned) message array at exactly the right place.
 */
interface Slot {
  text: string;
  apply: (out: ModelMessage[], compressed: string) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function collectSlots(messages: ModelMessage[]): Slot[] {
  const slots: Slot[] = [];

  messages.forEach((msg, i) => {
    const role = (msg as any).role as string;
    const content = (msg as any).content;

    // system: content is a plain string.
    if (role === 'system') {
      if (typeof content === 'string') {
        slots.push({
          text: content,
          apply: (out, c) => {
            out[i] = { ...(out[i] as any), content: c } as ModelMessage;
          },
        });
      }
      return;
    }

    // user / assistant: string content, or an array of parts (text/image/…).
    if (role === 'user' || role === 'assistant') {
      if (typeof content === 'string') {
        slots.push({
          text: content,
          apply: (out, c) => {
            out[i] = { ...(out[i] as any), content: c } as ModelMessage;
          },
        });
        return;
      }
      if (Array.isArray(content)) {
        content.forEach((part: any, p: number) => {
          if (part && part.type === 'text' && typeof part.text === 'string') {
            slots.push({
              text: part.text,
              apply: (out, c) => replacePart(out, i, p, (prev) => ({ ...prev, text: c })),
            });
          }
        });
      }
      return;
    }

    // tool: an array of tool-result parts. We only touch text/json outputs and
    // leave tool names, ids, and richer output shapes (content/error) intact.
    if (role === 'tool' && Array.isArray(content)) {
      content.forEach((part: any, p: number) => {
        if (part && part.type === 'tool-result') {
          const read = readToolOutput(part);
          if (read && read.text.length > 0) {
            slots.push({
              text: read.text,
              apply: (out, c) =>
                replacePart(out, i, p, (prev) => ({
                  ...prev,
                  output: buildToolOutput(c, read.isJson),
                })),
            });
          }
        }
      });
    }
  });

  return slots;
}

/** Immutably replace part `p` of message `i` in the cloned output array. */
function replacePart(
  out: ModelMessage[],
  i: number,
  p: number,
  update: (prev: any) => any,
): void {
  const current = (out[i] as any).content;
  const parts = Array.isArray(current) ? [...current] : [];
  if (!parts[p]) return;
  parts[p] = update(parts[p]);
  out[i] = { ...(out[i] as any), content: parts } as ModelMessage;
}

/**
 * Read a tool-result's payload as a string. Supports the AI SDK v5/v6
 * `output: { type, value }` shape and the legacy `result` field. Returns null
 * for shapes we must not rewrite (multi-part `content`, `error-*`).
 */
function readToolOutput(part: any): { text: string; isJson: boolean } | null {
  const o = part.output;
  if (o && typeof o === 'object' && typeof o.type === 'string' && 'value' in o) {
    if (o.type === 'text' && typeof o.value === 'string') return { text: o.value, isJson: false };
    if (o.type === 'json') return { text: safeStringify(o.value), isJson: true };
    return null; // 'content' | 'error-text' | 'error-json' → leave untouched
  }
  if ('result' in part && part.result !== undefined) {
    const r = part.result;
    return typeof r === 'string' ? { text: r, isJson: false } : { text: safeStringify(r), isJson: true };
  }
  return null;
}

/**
 * Wrap a compressed string back into a tool-result `output`. Headroom's
 * compact JSON form is usually not re-parseable, so a `json` original that
 * doesn't round-trip is stored as `text` — universally accepted by providers.
 */
function buildToolOutput(compressed: string, isJson: boolean): any {
  if (isJson) {
    try {
      return { type: 'json', value: JSON.parse(compressed) };
    } catch {
      /* fall through to text */
    }
  }
  return { type: 'text', value: compressed };
}

/** Pull the text content out of a (compressed) OpenAI-format message. */
function extractText(message: { role: string; content: unknown } | undefined): string {
  if (!message) return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('');
  }
  return '';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}
