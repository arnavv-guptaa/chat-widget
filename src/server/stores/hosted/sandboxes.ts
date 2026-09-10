import 'server-only';
import type { ToolSet } from 'ai';
import type { BuiltTools, ChatRequestContext } from '../../handler-types';
import { connectMcpTools } from '../../mcp';
import { assertPublicHttpUrl } from '../../net-guard';
import { verifySandboxArtifact } from '../../sandbox-artifacts';
import { SANDBOX_TOOL_NAMES } from '../../sandbox-messages';
import type { ManagedSandboxIntegration, ManagedSandboxStatus } from '../../sandbox-types';
import type { HostedOptions } from './store';

const DEFAULT_BASE = 'https://api.mordn.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Bound even a fetch override / body reader that ignores AbortSignal. */
function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const dispose = () => signal.removeEventListener('abort', aborted);
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(work).then(
      (value) => { dispose(); resolve(value); },
      (error) => { dispose(); reject(error); },
    );
  });
}

import { ManagedSandboxUnavailableError } from '../../sandbox-errors';
export { ManagedSandboxUnavailableError } from '../../sandbox-errors';

function apiBase(options: HostedOptions): { base: string; loopback: boolean } {
  const raw = options.selfBaseUrl ?? options.baseUrl ?? DEFAULT_BASE;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid managed sandbox API origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol)) throw new Error('Managed sandbox API must be an HTTP(S) origin without credentials or a path');
  if (options.selfBaseUrl !== undefined) {
    // Literal loopback has no DNS rebinding window and cannot reach metadata or
    // another private tenant host. The caller deliberately opts in server-side.
    if (!['127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Managed sandbox selfBaseUrl must use literal 127.0.0.1 or [::1] loopback');
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('Managed sandbox API requires HTTPS; use selfBaseUrl for trusted loopback');
  }
  return { base: url.origin, loopback: options.selfBaseUrl !== undefined };
}

/**
 * Managed-only adapter for createChatHandler({ sandboxes: ... }). Construction,
 * status and tools/list never provision a sandbox. Only a live curated tools/call
 * may allocate; the Mordn API owns published config, operator gate and full scope.
 * No Blaxel endpoint, workspace id or credential ever enters this process.
 */
export function createHostedSandboxes(hostedOptions: HostedOptions): ManagedSandboxIntegration {
  if (!hostedOptions.apiKey) throw new Error('[chat-widget] createHostedSandboxes requires an apiKey');
  const options = { ...hostedOptions };
  let client: ManagedSandboxIntegration | undefined;
  // Disabled agents must not validate/dial a provider or regress an existing
  // self-hosted baseUrl. Origin validation occurs only at the first gated use.
  const getClient = () => client ??= createSandboxClient(options);
  return {
    kind: 'mordn-managed',
    status: async (ctx) => getClient().status(ctx),
    buildTools: async (ctx, turn) => getClient().buildTools(ctx, turn),
  };
}

function createSandboxClient(options: HostedOptions): ManagedSandboxIntegration {
  const { base, loopback } = apiBase(options);
  // Unlike ordinary hosted reads, even timeoutMs:0 cannot unbound tool work.
  const timeoutMs = Math.min(
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0 && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs : MAX_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function scopedFetch(ctx: ChatRequestContext, signal?: AbortSignal): Promise<typeof fetch> {
    const userId = ctx.userId;
    if (!userId || userId.startsWith('anon:') || /[\u0000-\u001f\u007f]/.test(userId)) {
      throw new ManagedSandboxUnavailableError('Managed sandboxes require a verified, signed-in user. No sandbox tool was run.');
    }
    // Validate before attaching credentials. Private URLs remain forbidden by
    // default. Only the fixed, explicit loopback origin may bypass this guard.
    await assertPublicHttpUrl(base, { allowPrivate: loopback });
    const scopeSignal = signal ?? ctx.abortSignal ?? ctx.request.signal;
    scopeSignal.throwIfAborted();
    return async (input, init) => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw);
      if (url.origin !== base || url.username || url.password || url.search || url.hash ||
          !['/v1/sandbox/status', '/v1/sandbox/mcp', '/v1/uploads/resign'].includes(url.pathname)) {
        throw new Error('Blocked managed sandbox transport destination');
      }
      const controller = new AbortController();
      const signals = [scopeSignal, ...(init?.signal ? [init.signal] : [])];
      const abort = () => controller.abort();
      for (const caller of signals) {
        if (caller.aborted) abort();
        else caller.addEventListener('abort', abort, { once: true });
      }
      const timer = setTimeout(abort, timeoutMs);
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set('Authorization', `Bearer ${options.apiKey}`);
      headers.set('X-Chat-User', userId); // NEVER forward the inbound header.
      try {
        controller.signal.throwIfAborted();
        const response = await abortable(fetchImpl(input, {
          ...init, headers, cache: 'no-store', redirect: 'error', signal: controller.signal,
        }), controller.signal);
        // Bound the BODY as well as time-to-headers. Stateless MCP returns JSON;
        // a streaming/SSE provider endpoint is intentionally not supported here.
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
          void response.body?.cancel().catch(() => {});
          throw new Error('Managed sandbox response exceeds its byte limit');
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            controller.signal.throwIfAborted();
            const next = await abortable(reader.read(), controller.signal);
            if (next.done) break;
            size += next.value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new Error('Managed sandbox response exceeds its byte limit');
            chunks.push(next.value);
          }
        } catch (error) {
          void reader.cancel().catch(() => {});
          throw error;
        } finally { reader.releaseLock(); }
        controller.signal.throwIfAborted();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        // A new Response preserves SDK access to status/headers with an already
        // bounded body. No redirect fallback and no body from an old signed URL.
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      } finally {
        clearTimeout(timer);
        for (const caller of signals) caller.removeEventListener('abort', abort);
      }
    };
  }

  async function readStatus(ctx: ChatRequestContext, doFetch: typeof fetch, signal = ctx.abortSignal ?? ctx.request.signal): Promise<ManagedSandboxStatus> {
    try {
      const response = await doFetch(`${base}/v1/sandbox/status`, { method: 'GET' });
      if (!response.ok) throw new ManagedSandboxUnavailableError();
      const body: unknown = await response.json();
      if (!record(body) || typeof body.enabled !== 'boolean' || typeof body.available !== 'boolean') {
        throw new ManagedSandboxUnavailableError();
      }
      return { enabled: body.enabled, available: body.available };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ManagedSandboxUnavailableError) throw error;
      throw new ManagedSandboxUnavailableError();
    }
  }

  return {
    kind: 'mordn-managed',
    async status(ctx) {
      try { return await readStatus(ctx, await scopedFetch(ctx)); }
      catch (error) {
        (ctx.abortSignal ?? ctx.request.signal).throwIfAborted();
        if (error instanceof ManagedSandboxUnavailableError) throw error;
        throw new ManagedSandboxUnavailableError();
      }
    },
    async buildTools(ctx, { abortSignal, onArtifact }): Promise<BuiltTools> {
      let doFetch: typeof fetch;
      try { doFetch = await scopedFetch(ctx, abortSignal); }
      catch (error) {
        abortSignal.throwIfAborted();
        if (error instanceof ManagedSandboxUnavailableError) throw error;
        throw new ManagedSandboxUnavailableError();
      }
      const status = await readStatus(ctx, doFetch, abortSignal);
      if (!status.enabled) throw new ManagedSandboxUnavailableError('Publish Enable sandboxes for this agent before using its workspace. No sandbox tool was run.');
      if (!status.available) throw new ManagedSandboxUnavailableError();
      abortSignal.throwIfAborted();
      const connected = await connectMcpTools([{
        id: 'sandbox', transport: 'http', url: `${base}/v1/sandbox/mcp`, namespaceTools: false,
        headers: { Authorization: `Bearer ${options.apiKey}`, 'X-Chat-User': ctx.userId },
      }], { fetch: doFetch, signal: abortSignal, ...(loopback ? { allowPrivateHosts: true } : {}) });
      try {
        abortSignal.throwIfAborted();
        if (!connected.results.some((result) => result.id === 'sandbox' && result.ok) ||
            SANDBOX_TOOL_NAMES.some((name) => typeof connected.tools[name]?.execute !== 'function')) {
          throw new ManagedSandboxUnavailableError();
        }
        const tools: ToolSet = {};
        for (const name of SANDBOX_TOOL_NAMES) {
          const original = connected.tools[name];
          const execute = original.execute!;
          tools[name] = {
            ...original,
            execute: async (input, toolOptions) => {
              abortSignal.throwIfAborted();
              const signal = toolOptions.abortSignal ? AbortSignal.any([abortSignal, toolOptions.abortSignal]) : abortSignal;
              try {
                const result: unknown = await execute.call(original, input, { ...toolOptions, abortSignal: signal });
                signal.throwIfAborted();
                if (!record(result) || result.isError === true || Symbol.asyncIterator in result) {
                  throw new Error('Managed sandbox tool failed. No successful result was returned.');
                }
                if (name !== 'sandbox_publish_file') return result;
                const artifact = await verifySandboxArtifact(result, async (storagePath) => {
                  // Exact-scope backend verification through the existing
                  // {url} signer. Optional {file} canonical metadata is accepted;
                  // the publisher's response is already trusted API metadata.
                  const response = await doFetch(`${base}/v1/uploads/resign`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storagePath }), signal,
                  });
                  return response.ok ? response.json() : null;
                }, signal);
                signal.throwIfAborted();
                onArtifact(artifact);
                const canonical = { file: artifact.file };
                // Preserve MCP's envelope for its toModelOutput implementation.
                return record(result) && Object.prototype.hasOwnProperty.call(result, 'file') ? canonical : {
                  ...(record(result) ? result : {}), structuredContent: canonical,
                  content: [{ type: 'text', text: JSON.stringify(canonical) }],
                };
              } catch {
                signal.throwIfAborted();
                // Safe copy only. Never echo SDK transport errors (may contain
                // credentials) or turn a failed tool result into a success card.
                throw new Error(name === 'sandbox_publish_file'
                  ? 'Sandbox output could not be published and verified. No download was attached; do not claim success.'
                  : 'Managed sandbox tool failed or timed out. No successful result was returned; do not assume it completed.');
              }
            },
          };
        }
        // Extra provider/account tools are never exposed, even if the API
        // accidentally lists them. Only the curated static names survive.
        return { tools, cleanup: connected.cleanup };
      } catch (error) {
        await connected.cleanup();
        throw error;
      }
    },
  };
}
