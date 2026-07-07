/**
 * The single ingestion entry point.
 *
 * ADMIN-ONLY by construction: it requires a write-capable `KnowledgeStore`,
 * which `createChatHandler` is never given — so an end user hitting `/api/chat`
 * has no code path to mutate the KB. The CALLER is responsible for having
 * authorised this as an admin action and for resolving `namespace` from trusted
 * server context (never from a chat user's request body).
 *
 * Pipeline:
 *   loader (SSRF-guarded) → extract (docs-aware: HTML→markdown, else clean text)
 *     → chunk (heading-aware `chunkMarkdown` for markdown, else `chunkText`)
 *     → contentHash + resync diff → embed (in the store) → idempotent upsert
 *     → onProgress
 *
 * Docs-aware (DOCS_CONTRACT §1–§3, default on via `docsMode`): markdown sources
 * are chunked by section and every chunk is stamped with `anchor` (nearest
 * heading slug) + `headingPath` (breadcrumb joined by " › ") so retrieval can
 * deep-link to the exact section. `docsMode: false` restores the legacy plain
 * path for every source.
 *
 * Idempotency: a per-source sha256 contentHash lets the store skip unchanged
 * sources; replacing a source with fewer chunks deletes the orphaned tail. The
 * pipeline never throws on a single source's failure — it records it in
 * `report.errors` and continues, so one dead link can't abort a 100-page sync.
 * The contentHash is taken over the CLEANED TEXT (pre-chunk), so it is stable
 * regardless of which chunker ran — resync stays byte-compatible.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import type {
  IngestOptions,
  IngestReport,
  IngestSource,
  KnowledgeDoc,
  KnowledgeStore,
  Embedder,
} from './types';
import type { StorageAdapter } from '../storage-adapter';
import { chunkText } from './chunk';
import { chunkMarkdown } from './chunk-markdown';
import { expandSources, loadLeaf, type LeafSource } from './loaders';

export interface IngestArgs extends IngestOptions {
  /** Write-capable store, bound to `namespace`. Admin/ingestion only. */
  store: KnowledgeStore;
  /** Server-resolved namespace (agent:… / tenant:… / user:…:…). */
  namespace: string;
  /** Sources to ingest. */
  sources: IngestSource[];
  /** Embedder — kept in the signature per the contract; the store embeds with
   *  its own configured embedder, so this is informational/forward-compatible. */
  embedder?: Embedder;
  /** StorageAdapter for `file` sources (private, user-bound). */
  storage?: StorageAdapter;
}

/** Map a leaf back to its originating source descriptor (for inline text/file). */
function originFor(leaf: LeafSource, sources: IngestSource[]): IngestSource | undefined {
  return sources.find((s) => {
    if (s.type === 'text') return leaf.kind === 'text' && (s.title ? `text:${s.title}` === leaf.ref : leaf.ref.startsWith('text:'));
    if (s.type === 'file') return leaf.kind === 'file' && (s.fileKey ?? s.path ?? s.filename) === leaf.ref;
    if (s.type === 'url') return leaf.kind === 'url' && s.url === leaf.ref;
    return false;
  });
}

export async function ingest(args: IngestArgs): Promise<IngestReport> {
  const t0 = Date.now();
  const { store, sources, storage } = args;
  const onProgress = args.onProgress ?? (() => {});
  const report: IngestReport = {
    sources: 0,
    chunks: 0,
    skipped: 0,
    deleted: 0,
    errors: [],
    durationMs: 0,
  };

  // Expand sitemap/crawl into concrete leaves first so `total` is meaningful.
  let leaves: LeafSource[];
  try {
    onProgress({ done: 0, total: 0, stage: 'fetch', message: 'expanding sources' });
    leaves = await expandSources(sources, args);
  } catch (err) {
    report.errors.push({ source: 'expand', error: errMsg(err) });
    report.durationMs = Date.now() - t0;
    onProgress({ done: 0, total: 0, stage: 'error', message: errMsg(err) });
    return report;
  }

  const total = leaves.length;
  let done = 0;

  for (const leaf of leaves) {
    try {
      onProgress({ done, total, stage: 'fetch', source: leaf.ref });
      const origin = originFor(leaf, sources);
      const { text, title, mediaType, isMarkdown } = await loadLeaf(leaf, origin, {
        storage,
        crawl: args.crawl,
        docsMode: args.docsMode,
      });

      onProgress({ done, total, stage: 'extract', source: leaf.ref });
      const clean = text.trim();
      if (!clean) {
        // Empty source: nothing to embed. Count as processed (no error).
        report.sources++;
        done++;
        continue;
      }

      // contentHash over the cleaned text (pre-chunk) → stable resync key shared
      // by all chunks of this source, independent of which chunker runs.
      const contentHash = createHash('sha256').update(clean).digest('hex');
      const ingestedAt = Date.now();

      onProgress({ done, total, stage: 'chunk', source: leaf.ref });
      const chunkOpts = { chunkSize: args.chunkSize, overlap: args.overlap };

      // Docs-aware routing (default on): markdown → heading-aware chunker that
      // emits per-chunk section metadata; everything else → the plain chunker.
      // Both share the SAME base metadata below so existing keys are unchanged.
      const docs: KnowledgeDoc[] = isMarkdown
        ? chunkMarkdown(clean, chunkOpts).map((chunk, i) => ({
            text: chunk.text,
            source: leaf.ref,
            title: title ?? leaf.title ?? leaf.ref,
            metadata: {
              mediaType,
              origin: leaf.kind,
              chunkIndex: i,
              contentHash,
              ingestedAt,
              // Deep-link citation metadata (DOCS_CONTRACT §3). `headingPath` is
              // JOINED into a string — `ChunkMetadata` values are scalars only.
              ...(chunk.anchor ? { anchor: chunk.anchor } : {}),
              ...(chunk.headingPath && chunk.headingPath.length
                ? { headingPath: chunk.headingPath.join(' › ') }
                : {}),
            },
          }))
        : chunkText(clean, chunkOpts).map((chunk, i) => ({
            text: chunk,
            source: leaf.ref,
            title: title ?? leaf.title ?? leaf.ref,
            metadata: {
              mediaType,
              origin: leaf.kind,
              chunkIndex: i,
              contentHash,
              ingestedAt,
            },
          }));

      onProgress({ done, total, stage: 'embed', source: leaf.ref });
      onProgress({ done, total, stage: 'upsert', source: leaf.ref });
      // store.upsert embeds internally (its configured embedder) and
      // short-circuits if contentHash is unchanged.
      const res = await store.upsert(docs);

      if (res.skippedSources > 0 && res.upsertedChunks === 0) report.skipped++;
      else report.sources++;
      report.chunks += res.upsertedChunks;
      report.deleted += res.deletedOrphans;
    } catch (err) {
      report.errors.push({ source: leaf.ref, error: errMsg(err) });
      onProgress({ done, total, stage: 'error', source: leaf.ref, message: errMsg(err) });
    } finally {
      done++;
    }
  }

  onProgress({ done, total, stage: 'done' });
  report.durationMs = Date.now() - t0;
  return report;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
