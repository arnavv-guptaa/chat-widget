/**
 * RAG eval / regression suite — a CI-checkable answer-quality gate for the
 * knowledge base.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * Docs-as-code teams run CI for everything they ship EXCEPT the AI layer that
 * answers questions about those docs. When they re-crawl, restructure, or
 * re-chunk their documentation, retrieval can silently regress: the page that
 * used to answer "how do I install with pnpm?" quietly stops surfacing, and no
 * test goes red. Every RAG vendor claims accuracy; almost none hands the
 * customer a way to *verify* it in their pipeline. This module turns
 * "grounding" from a marketing claim into a checkable artifact.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS (and, deliberately, what it does NOT)
 * ──────────────────────────────────────────────────────────────────────────
 * These are RETRIEVAL-LEVEL assertions only — "did the right passage come back
 * in the top-K, with enough score?" They run against a `Retriever`, call
 * `query()`, and inspect the returned chunks. There are NO LLM calls: no answer
 * generation, no judge model, no embedding spend beyond the one query embedding
 * the retriever already does. That is the whole point — it is free enough to run
 * on every push. Answer-level assertions (does the generated reply contain
 * keyword X) are a deliberate future layer, gated behind a model key; the issue
 * (#202) scopes them out of the cheap CI path and so do we.
 *
 * The four checks:
 *   • sourceIncludes    — some retrieved chunk's citation URL / source contains
 *                         the substring (string or string[] → ANY matches).
 *   • notSourceIncludes — NO retrieved chunk's citation URL / source matches
 *                         (guards against a legacy/wrong page creeping back in).
 *   • minScore          — the TOP retrieved score is ≥ the threshold.
 *   • anchor            — some retrieved chunk carries a `metadata.anchor` that
 *                         contains the substring. This check only lights up once
 *                         docs-aware ingestion (PR #207) stamps `anchor` on
 *                         chunk metadata per the build contract §3; before that
 *                         it fails with a clear "no chunk has metadata.anchor"
 *                         detail rather than silently passing.
 * All string matching is case-insensitive substring matching.
 *
 * A case PASSES when ALL of its declared checks pass. Empty retrieval fails any
 * `sourceIncludes` / `minScore` / `anchor` check with an explicit detail (and
 * passes `notSourceIncludes`, which is vacuously satisfied when nothing came
 * back).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FILE FORMAT (versioned)
 * ──────────────────────────────────────────────────────────────────────────
 * Eval suites are authored as JSON today (see `EvalFile`), `version: 1`. YAML is
 * a plausible follow-up — the shape is identical, only the parse step differs —
 * but we add NO yaml dependency now; the CLI reads JSON. `defaults` supplies the
 * retrieval knobs (`topK`, `minScore`) applied to every case unless the case
 * overrides them; per-case `expect` holds the assertions.
 *
 *   {
 *     "version": 1,
 *     "defaults": { "topK": 5, "minScore": 0.2 },
 *     "cases": [
 *       {
 *         "id": "install-pnpm",
 *         "question": "How do I install with pnpm?",
 *         "topK": 8,
 *         "expect": {
 *           "sourceIncludes": "docs.example.com/install",
 *           "anchor": "pnpm",
 *           "minScore": 0.4,
 *           "notSourceIncludes": "legacy"
 *         }
 *       }
 *     ]
 *   }
 *
 * This module is pure and dependency-free (its only import is `citationUrl` from
 * the retrieval glue, itself dependency-free). It takes a `Retriever` — never a
 * store — so it is safe anywhere a read surface is, and the CLI can build one
 * exactly the way `ingest` builds its store.
 */

import 'server-only';
import type { Retriever, RetrievedChunk, QueryOptions } from './types';
import { citationUrl } from './retrieval';

// ── Eval file / case shapes (version 1) ──────────────────────────────────────

/** The four assertion kinds a case can declare. Each is optional; a case runs
 *  only the checks it names, and passes when ALL of them pass. */
export interface EvalExpect {
  /**
   * Pass when ANY retrieved chunk's citation URL or source contains this
   * substring (case-insensitive). A `string[]` is OR-ed: any listed substring
   * matching any chunk satisfies the check.
   */
  sourceIncludes?: string | string[];
  /**
   * Pass when NO retrieved chunk's citation URL or source contains this
   * substring (case-insensitive). Catches a wrong/legacy page regressing back
   * into the top-K. A `string[]` fails if ANY listed substring matches ANY
   * chunk.
   */
  notSourceIncludes?: string | string[];
  /** Pass when the TOP retrieved chunk's score is ≥ this value. */
  minScore?: number;
  /**
   * Pass when SOME retrieved chunk's `metadata.anchor` contains this substring
   * (case-insensitive). Requires docs-aware ingestion (PR #207) to stamp
   * `anchor`; before that this check fails with an explanatory detail.
   */
  anchor?: string;
}

/** One eval case: a question plus what we expect retrieval to surface. */
export interface EvalCase {
  /** Stable, human-readable id used in output + as the regression key. */
  id: string;
  /** The user question to run through the retriever. */
  question: string;
  /** The assertions. A case with no checks trivially passes (documents intent). */
  expect?: EvalExpect;
  /** Per-case override of the retrieval `topK` (else `defaults.topK`, else 5). */
  topK?: number;
  /**
   * Per-case override of the retrieval `minScore` FLOOR passed to `query()`
   * (else `defaults.minScore`). This is the retrieval noise floor — distinct
   * from `expect.minScore`, which asserts on the top score of what came back.
   */
  minScore?: number;
}

/** Suite-wide retrieval defaults, applied per case unless the case overrides. */
export interface EvalDefaults {
  /** Default `topK` for every case. Falls back to 5 (the retriever's default). */
  topK?: number;
  /** Default retrieval `minScore` FLOOR for every case (query-time noise cut). */
  minScore?: number;
  /** Default metadata equality filter forwarded to `query()` (e.g. `{ lang: 'en' }`). */
  filter?: QueryOptions['filter'];
}

/** The on-disk eval file, version 1. */
export interface EvalFile {
  /** Schema version. Only `1` is understood today; others throw on load. */
  version: number;
  defaults?: EvalDefaults;
  cases: EvalCase[];
}

// ── Result shapes ─────────────────────────────────────────────────────────────

/** One check's outcome within a case. `kind` echoes the assertion that ran. */
export interface EvalCheckResult {
  kind: 'sourceIncludes' | 'notSourceIncludes' | 'minScore' | 'anchor';
  pass: boolean;
  /** Human-readable why — e.g. "top score 0.31 < 0.40" or "no chunk matched". */
  detail: string;
}

/** A retrieved chunk, flattened for the report (score + citation + anchor). */
export interface EvalRetrieved {
  url: string;
  title?: string;
  score: number;
  anchor?: string;
}

/** Per-case result: pass/fail, the individual checks, and what was retrieved. */
export interface EvalCaseResult {
  id: string;
  question: string;
  pass: boolean;
  checks: EvalCheckResult[];
  retrieved: EvalRetrieved[];
  /** Present only when the retriever itself threw for this case. */
  error?: string;
}

/** The full suite result. `passed + failed === total`; sort stays input order. */
export interface EvalRunResult {
  passed: number;
  failed: number;
  total: number;
  durationMs: number;
  results: EvalCaseResult[];
}

/** Args for {@link runEvals}. */
export interface RunEvalsArgs {
  /** The (namespace-fenced) read surface to query. */
  retriever: Retriever;
  /** The cases to run, in order. */
  cases: EvalCase[];
  /** Suite-wide retrieval defaults. */
  defaults?: EvalDefaults;
}

// ── Matching helpers (pure) ───────────────────────────────────────────────────

/** Normalise a `string | string[]` assertion into a lowercased array. */
function needles(v: string | string[]): string[] {
  return (Array.isArray(v) ? v : [v]).map((s) => s.toLowerCase());
}

/**
 * The haystacks one retrieved chunk contributes to source matching: its citation
 * URL (the clickable/deep-linked href the widget would render) AND its raw
 * `source.url` / `source.title`. Matching either is intentional — an author may
 * write the assertion against the human URL or the citation form. All lowercased.
 */
function sourceHaystacks(c: RetrievedChunk): string[] {
  const out: string[] = [];
  try {
    out.push(citationUrl(c));
  } catch {
    /* citationUrl is total for well-formed chunks; guard defensively anyway. */
  }
  if (c.source?.url) out.push(c.source.url);
  if (c.source?.title) out.push(c.source.title);
  return out.map((s) => s.toLowerCase());
}

/** The anchor substring haystack for a chunk (from `metadata.anchor`), or ''. */
function anchorOf(c: RetrievedChunk): string {
  const a = c.metadata?.anchor;
  return typeof a === 'string' ? a : '';
}

// ── The checks ────────────────────────────────────────────────────────────────

function checkSourceIncludes(chunks: RetrievedChunk[], expected: string | string[]): EvalCheckResult {
  const wants = needles(expected);
  if (chunks.length === 0) {
    return { kind: 'sourceIncludes', pass: false, detail: `no chunks retrieved; expected a source containing ${JSON.stringify(expected)}` };
  }
  const hays = chunks.flatMap(sourceHaystacks);
  const hit = wants.find((w) => hays.some((h) => h.includes(w)));
  if (hit !== undefined) {
    return { kind: 'sourceIncludes', pass: true, detail: `matched "${hit}"` };
  }
  return {
    kind: 'sourceIncludes',
    pass: false,
    detail: `no retrieved source contains ${JSON.stringify(expected)}; got [${chunks.map((c) => citationUrl(c)).join(', ')}]`,
  };
}

function checkNotSourceIncludes(chunks: RetrievedChunk[], banned: string | string[]): EvalCheckResult {
  const wants = needles(banned);
  const hays = chunks.flatMap(sourceHaystacks);
  const offending = wants.find((w) => hays.some((h) => h.includes(w)));
  if (offending !== undefined) {
    return { kind: 'notSourceIncludes', pass: false, detail: `a retrieved source unexpectedly contains "${offending}"` };
  }
  return { kind: 'notSourceIncludes', pass: true, detail: `no retrieved source contains ${JSON.stringify(banned)}` };
}

function checkMinScore(chunks: RetrievedChunk[], min: number): EvalCheckResult {
  if (chunks.length === 0) {
    return { kind: 'minScore', pass: false, detail: `no chunks retrieved; expected a top score ≥ ${min}` };
  }
  const top = Math.max(...chunks.map((c) => c.score));
  if (top >= min) {
    return { kind: 'minScore', pass: true, detail: `top score ${top.toFixed(3)} ≥ ${min}` };
  }
  return { kind: 'minScore', pass: false, detail: `top score ${top.toFixed(3)} < ${min}` };
}

function checkAnchor(chunks: RetrievedChunk[], expected: string): EvalCheckResult {
  const want = expected.toLowerCase();
  const withAnchor = chunks.map(anchorOf).filter(Boolean);
  if (chunks.length === 0) {
    return { kind: 'anchor', pass: false, detail: `no chunks retrieved; expected an anchor containing "${expected}"` };
  }
  if (withAnchor.length === 0) {
    return {
      kind: 'anchor',
      pass: false,
      detail: `no retrieved chunk has metadata.anchor (needs docs-aware ingestion, PR #207); expected "${expected}"`,
    };
  }
  if (withAnchor.some((a) => a.toLowerCase().includes(want))) {
    return { kind: 'anchor', pass: true, detail: `matched anchor containing "${expected}"` };
  }
  return { kind: 'anchor', pass: false, detail: `no anchor contains "${expected}"; got [${withAnchor.join(', ')}]` };
}

/** Run the declared checks for one case against its retrieved chunks. */
function runChecks(chunks: RetrievedChunk[], expect: EvalExpect | undefined): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  if (!expect) return checks;
  if (expect.sourceIncludes !== undefined) checks.push(checkSourceIncludes(chunks, expect.sourceIncludes));
  if (expect.notSourceIncludes !== undefined) checks.push(checkNotSourceIncludes(chunks, expect.notSourceIncludes));
  if (expect.minScore !== undefined) checks.push(checkMinScore(chunks, expect.minScore));
  if (expect.anchor !== undefined) checks.push(checkAnchor(chunks, expect.anchor));
  return checks;
}

/** Flatten retrieved chunks into the report's compact shape. */
function toRetrieved(chunks: RetrievedChunk[]): EvalRetrieved[] {
  return chunks.map((c) => {
    const anchor = anchorOf(c);
    return {
      url: citationUrl(c),
      title: c.source?.title,
      score: c.score,
      ...(anchor ? { anchor } : {}),
    };
  });
}

// ── The runner ────────────────────────────────────────────────────────────────

/**
 * Run an eval suite against a retriever. Never throws for a case failure — a
 * retriever error is captured per case as `error` + a synthetic failing check,
 * so one bad case can't abort the suite (mirrors `ingest`'s per-source error
 * accounting). The caller decides what to do with the exit-code semantics:
 * `failed === 0` ⇒ green (exit 0), any failure ⇒ red (exit 1).
 *
 * Cases run sequentially to keep query load predictable in CI (retrievers embed
 * the query and hit a vector store per call); suites are tens of questions, so
 * wall-clock is dominated by network, not by our loop.
 */
export async function runEvals({ retriever, cases, defaults }: RunEvalsArgs): Promise<EvalRunResult> {
  const started = Date.now();
  const results: EvalCaseResult[] = [];

  for (const c of cases) {
    const opts: QueryOptions = {
      topK: c.topK ?? defaults?.topK,
      minScore: c.minScore ?? defaults?.minScore,
      filter: defaults?.filter,
    };
    let chunks: RetrievedChunk[] = [];
    let error: string | undefined;
    try {
      chunks = await retriever.query(c.question, opts);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const checks = error
      ? [{ kind: 'sourceIncludes' as const, pass: false, detail: `retriever threw: ${error}` }]
      : runChecks(chunks, c.expect);
    // A case with an error, or with any failing check, fails. A case with no
    // checks and no error passes (an intentionally-empty assertion set).
    const pass = !error && checks.every((k) => k.pass);

    results.push({
      id: c.id,
      question: c.question,
      pass,
      checks,
      retrieved: toRetrieved(chunks),
      ...(error ? { error } : {}),
    });
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    passed,
    failed: results.length - passed,
    total: results.length,
    durationMs: Date.now() - started,
    results,
  };
}
