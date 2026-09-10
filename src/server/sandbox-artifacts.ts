// Dependency-free artifact boundary. A JSON-shaped file is NOT a verified artifact.
// Only a live managed publish execution calls verifySandboxArtifact. Its signer
// resolves exact tenant/agent/user provenance; neither model metadata nor a path
// prefix is sufficient. The WeakSet capability never round-trips through JSON.

export interface SandboxFile {
  readonly type: 'file';
  readonly url: string;
  readonly storagePath: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly size: number;
}

/**
 * Read-only carrier, authenticated at runtime by isVerifiedSandboxArtifact.
 * Deliberately structural so independently bundled /server and /server/hosted
 * declaration files remain assignable; a TypeScript cast is NOT authority.
 */
export interface VerifiedSandboxArtifact {
  readonly file: SandboxFile;
}
// tsup emits independent /server and /server/hosted bundles (splitting:false).
// Share the opaque capability set across those copies, including CJS/ESM. It is
// server-process-only, weakly held, and cannot be created by JSON/replay input.
const registryKey = Symbol.for('@mordn/chat-widget/verified-sandbox-artifacts/v1');
const registry = globalThis as typeof globalThis & { [key: symbol]: WeakSet<object> | undefined };
const verified = registry[registryKey] ??= new WeakSet<object>();
import { DEFAULT_UPLOAD_MEDIA_TYPES, SANDBOX_DOCUMENT_MEDIA_TYPES, SANDBOX_MAX_UPLOAD_BYTES } from './sandbox-policy';
const MAX_FILE_BYTES = SANDBOX_MAX_UPLOAD_BYTES;
const SAFE_OUTPUT_TYPES = new Set<string>([...DEFAULT_UPLOAD_MEDIA_TYPES, ...SANDBOX_DOCUMENT_MEDIA_TYPES]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Syntax only; authority lives in the API registry, never this predicate. */
export function isStorageReference(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    value.trim() === value && !/[\u0000-\u001f\u007f\\]/.test(value) &&
    !value.startsWith('/') && !value.includes('://') &&
    !value.split('/').some((part) => part === '..' || part === '.');
}

function safeDownloadUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

export function readSandboxFile(value: unknown): SandboxFile | null {
  if (!record(value) || value.type !== 'file' || !isStorageReference(value.storagePath) ||
      !safeDownloadUrl(value.url) || typeof value.filename !== 'string' ||
      value.filename.length === 0 || value.filename.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/.test(value.filename) ||
      typeof value.mediaType !== 'string' || !SAFE_OUTPUT_TYPES.has(value.mediaType) ||
      typeof value.size !== 'number' || !Number.isSafeInteger(value.size) ||
      value.size < 0 || value.size > MAX_FILE_BYTES) return null;
  return { type: 'file', url: value.url, storagePath: value.storagePath,
    filename: value.filename, mediaType: value.mediaType, size: value.size };
}

/**
 * Accept the SDK's MCP envelope (structuredContent, text JSON, or a structured
 * outputSchema result). This function is used ONLY on the live publish execute
 * return value, never on a replayed message, telemetry callback or another tool.
 */
function publishedFile(result: unknown): SandboxFile | null {
  if (!record(result) || result.isError === true) return null;
  if (record(result.structuredContent)) return readSandboxFile(result.structuredContent.file);
  if (Object.prototype.hasOwnProperty.call(result, 'file')) return readSandboxFile(result.file);
  if (!Array.isArray(result.content) || result.content.length !== 1) return null;
  const part = result.content[0];
  if (!record(part) || part.type !== 'text' || typeof part.text !== 'string' || part.text.length > 16384) return null;
  try {
    const body: unknown = JSON.parse(part.text);
    return record(body) ? readSandboxFile(body.file) : null;
  } catch { return null; }
}

/**
 * `result` MUST be the live curated publish response from the trusted Mordn
 * API, never model/client metadata. `resolve` MUST call that backend with the
 * same agent key + verified user and enforce exact-scope registry ownership.
 * The existing {url} signer contract is sufficient: filename/MIME/size already
 * came from the trusted API publisher, not the model. A richer {file} signer can
 * replace them with canonical metadata. No old URL fallback on any failure.
 */
export async function verifySandboxArtifact(
  result: unknown,
  resolve: (storagePath: string) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<VerifiedSandboxArtifact> {
  signal?.throwIfAborted();
  const candidate = publishedFile(result);
  if (!candidate) throw new Error('Sandbox publish returned an invalid file result. No download was attached.');
  const resolved = await resolve(candidate.storagePath);
  signal?.throwIfAborted();
  const file = record(resolved)
    ? Object.prototype.hasOwnProperty.call(resolved, 'file')
      ? readSandboxFile(resolved.file)
      : readSandboxFile({ ...candidate, url: resolved.url })
    : null;
  if (!file || file.storagePath !== candidate.storagePath) {
    throw new Error('Sandbox output could not be verified by storage. No download was attached.');
  }
  // Metadata comes from the live API publisher (or optional canonical signer),
  // NEVER from a model-supplied path/filename or a replayed message part.
  const artifact = Object.freeze({ file: Object.freeze(file) }) as VerifiedSandboxArtifact;
  verified.add(artifact);
  return artifact;
}

/** Handler-only sink gate. Forged/replayed JSON and another tool's output fail. */
export function isVerifiedSandboxArtifact(value: unknown): value is VerifiedSandboxArtifact {
  return record(value) && verified.has(value);
}

/**
 * SDK v6 file chunks have a strict shape: extension metadata rides in
 * providerMetadata, not extra top-level stream keys. Hydration happens at the
 * existing MessageItem/history boundary, with no custom data-* transport.
 */
export function sandboxArtifactChunk(artifact: VerifiedSandboxArtifact) {
  if (!isVerifiedSandboxArtifact(artifact)) throw new Error('Unverified sandbox artifact');
  const { file } = artifact;
  return {
    type: 'file' as const,
    url: file.url,
    mediaType: file.mediaType,
    providerMetadata: { mordn: { sandboxFile: {
      storagePath: file.storagePath, filename: file.filename, size: file.size,
    } } },
  };
}

/**
 * Persist full top-level file parts after SDK assembly, replacing ONLY chunks
 * emitted by this request's trusted sink. Never scan arbitrary tool output.
 */
export function applySandboxArtifacts<T extends { role: string; parts: unknown[] }>(
  message: T,
  artifacts: readonly VerifiedSandboxArtifact[],
): T {
  if (message.role !== 'assistant' || artifacts.length === 0) return message;
  const files = new Map(artifacts.filter(isVerifiedSandboxArtifact).map(({ file }) => [file.storagePath, file]));
  return { ...message, parts: message.parts.map((part) => {
    if (!record(part) || part.type !== 'file' || !record(part.providerMetadata) ||
        !record(part.providerMetadata.mordn) || !record(part.providerMetadata.mordn.sandboxFile)) return part;
    const ref = part.providerMetadata.mordn.sandboxFile.storagePath;
    const file = typeof ref === 'string' ? files.get(ref) : undefined;
    return file && file.url === part.url ? { ...file } : part;
  }) };
}
