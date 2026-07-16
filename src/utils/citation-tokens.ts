/**
 * Inline citation-token parsing for the chat renderer (#138).
 *
 * The model emits citation markers inline in assistant prose as either:
 *   - `[ref: N]`          — explicit ref form (used by the docs/RAG system prompt
 *     and the `searchKnowledge` tool's `ref` field).
 *   - `[ref: N, ref: M]`  — comma-separated list inside one bracket.
 *   - `[N]`               — bare numeric form (the auto-retrieve context prompt
 *     says "cite e.g. [1]").
 *
 * Without this, those tokens render as the literal strings "[ref: 4, ref: 6]" /
 * "[1]" — which is the bug: the widget HAS a numbered Sources card (built from
 * `source-url` parts, see message-item.tsx) but nothing links the inline text
 * to it. This module turns the tokens into `citeRef` mdast element nodes so the
 * `citeRef` component override in response.tsx can render them as superscript
 * chips that link to the Nth source (1-indexed, matching the Sources card).
 *
 * CONTRACT — [ref: N] maps to the Nth `source-url` part (1-indexed). The Sources
 * card numbers sources `index + 1` (sources.tsx), so chip N == source N in the
 * card. The model's own DOC numbers (from the retrieval context block) and the
 * deduped `toSourceParts` ordering can diverge, but mapping to source-url parts
 * is the right USER-FACING contract: the inline chip always lines up with the
 * visible numbered source the user can click. Out-of-range refs (N > source
 * count) render as a muted, non-linking chip so the prose still reads and we
 * never ship a broken href.
 *
 * DEPENDENCY-FREE by design. A naive hand-rolled mdast walker is used instead of
 * `unist-util-visit` to avoid adding a runtime dep and the strict-ESM dir-import
 * crash class that killed `react-syntax-highlighter` in #177. Only mdast `text`
 * nodes are split — code fences and inline code carry their text in `value`, not
 * as `text` children, so a `visit(tree, 'text')` walk never enters them and refs
 * inside code are correctly left as literal text.
 *
 * Pure (no React, no DOM) so it can run in the remark pipeline on the server or
 * client and is trivially unit-testable.
 */

// A minimal mdast node shape — enough to walk and mutate without pulling in
// `@types/mdast` (which we don't depend on). These are structurally identical to
// the real mdast nodes react-markdown/streamdown produce.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  // Element-only fields (hast/mdast element). `properties` carries the
  // data-attributes we stamp so the component override can read them.
  properties?: Record<string, unknown>;
  data?: { hProperties?: Record<string, unknown>; [k: string]: unknown };
}

/**
 * One parsed citation ref. `raw` is the original token text (e.g. "ref: 4" or
 * "4") so a renderer can fall back to it if needed; `n` is the 1-indexed source
 * number the chip links to.
 */
export interface ParsedRef {
  n: number;
  raw: string;
}

/**
 * Regex for the contents INSIDE a bracket that we treat as a citation. Matches
 * either the explicit `ref: N` form (optionally comma-separated, optionally
 * repeated `ref:`) or a bare positive integer. Anchored to the whole bracket
 * inner string so `[2024]` (a year) or `[v2]` (a version) is NOT mistaken for a
 * citation — only brackets whose entire content is ref-numbers qualify.
 *
 *   "ref: 4"            → match (one ref)
 *   "ref: 2, ref: 4"    → match (two refs)
 *   "ref: 2, 4"         → match (two refs — the repeated `ref:` is optional)
 *   "4"                 → match (bare)
 *   "2, 4"              → match (bare, comma-separated)
 *   "2024"              → no match (4-digit year — too large to be a ref index)
 *   "v2"                → no match (not numeric)
 *   "ref: foo"          → no match (non-numeric)
 *
 * The `ref:` prefix and whitespace are optional per item; items are comma-
 * separated. Numbers are 1–999 (aSources list is never that long; this also
 * excludes years 1000–9999 which would otherwise false-positive as bare refs).
 */
const REF_TOKEN_RE = /^(?:ref:\s*)?([1-9]\d{0,2})(?:\s*,\s*(?:ref:\s*)?([1-9]\d{0,2}))*$/i;

/**
 * A bracket that looks like a citation token. We match the whole bracket
 * (including its square brackets) so we can split it out of a text run precisely.
 * Captures the inner content (group 1). Only brackets whose inner content fully
 * matches REF_TOKEN_RE are treated as citations — checked in `parseRefs`.
 */
const BRACKET_RE = /\[((?:ref:\s*)?[1-9]\d{0,2}(?:\s*,\s*(?:ref:\s*)?[1-9]\d{0,2})*)\]/gi;

/** Upper bound on citation index — guards against a malformed/huge number. */
const MAX_REF = 999;

/**
 * Parse the inner content of a citation bracket into refs. Returns null if the
 * inner string is not a valid citation list (so the caller leaves it as text).
 */
export function parseRefs(inner: string): ParsedRef[] | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const m = REF_TOKEN_RE.exec(trimmed);
  if (!m) return null;

  // Re-extract every number from the inner string (the regex above validated the
  // shape; here we pull all the integers out in order).
  const nums: number[] = [];
  const numRe = /([1-9]\d{0,2})/g;
  let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(trimmed)) !== null) {
    const n = parseInt(nm[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= MAX_REF) nums.push(n);
  }
  if (nums.length === 0) return null;
  return nums.map((n) => ({ n, raw: String(n) }));
}

/**
 * Split a text string into an ordered list of segments: literal text and
 * citation refs. Citations keep their original bracket text in `raw` so a
 * renderer can show "ref: 4" if it ever needs to. Pure, no side effects.
 */
export type CitationSegment =
  | { kind: "text"; text: string }
  | { kind: "refs"; refs: ParsedRef[]; raw: string };

export function splitCitations(text: string): CitationSegment[] {
  if (!text) return [];
  const out: CitationSegment[] = [];
  let last = 0;
  // Reset the global regex state (it's module-level /g).
  BRACKET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_RE.exec(text)) !== null) {
    const inner = m[1];
    const refs = parseRefs(inner);
    if (!refs) continue; // not a citation — leave for the next text segment
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "refs", refs, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  // If we matched nothing, return a single text segment so callers can fast-path.
  if (out.length === 0) return [{ kind: "text", text }];
  return out;
}

/**
 * Tiny hand-rolled mdast walker (no `unist-util-visit` dep). Visits every node
 * in the tree, depth-first, calling `fn` with (node, parent). Mutating
 * `parent.children` (replacing one node with many) is supported via the return
 * value: `fn` may return an array of nodes to REPLACE the current node with, or
 * `undefined` to keep it as-is.
 */
function walk(
  root: MdNode,
  fn: (node: MdNode, parent: MdNode | null) => MdNode[] | undefined,
): void {
  const stack: { node: MdNode; parent: MdNode | null }[] = [{ node: root, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    const replacement = fn(node, parent);
    if (replacement && parent && parent.children) {
      const idx = parent.children.indexOf(node);
      if (idx >= 0) parent.children.splice(idx, 1, ...replacement);
      // Don't descend into the replacement here — its children are already
      // final (we only split text nodes, which have no children to revisit).
      continue;
    }
    if (node.children) {
      // Push children in reverse so depth-first order is preserved.
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push({ node: node.children[i], parent: node });
      }
    }
  }
}

/**
 * Build a `citeRef` mdast element node for one citation ref. Carries `n` and
 * `raw` as data properties so the `citeRef` component override can read them
 * without re-parsing. The `data.hProperties` path is how react-markdown
 * surfaces custom element attributes into the hast/component layer.
 */
function citeRefNode(ref: ParsedRef): MdNode {
  return {
    type: "citeRef",
    properties: { n: ref.n, raw: ref.raw },
    data: { hProperties: { "data-ref-n": String(ref.n), "data-ref-raw": ref.raw } },
  };
}

/**
 * The remark plugin. Walks the mdast tree, splits every `text` node on
 * citation tokens, and replaces each citation with one or more `citeRef`
 * element nodes (one per ref in a `[ref: N, ref: M]` list). Returns the
 * (mutated) tree. No-op when there are no citation tokens, so it's cheap on
 * non-cited answers.
 *
 * Usage: `remarkPlugins={[remarkCitations, ...streamdownDefaults]}` — prepend so
 * it runs before Streamdown's own transforms (it only touches `text` nodes,
 * which are stable across the earlier plugins, so order is not load-bearing, but
 * prepending keeps it out of the way of CJK/math plugins that may rewrite text).
 */
export function remarkCitations() {
  return (tree: MdNode) => {
    walk(tree, (node, parent) => {
      if (node.type !== "text" || typeof node.value !== "string" || !parent || !parent.children) {
        return undefined;
      }
      const segments = splitCitations(node.value);
      // Fast path: a single text segment with no citations → leave the node alone.
      if (segments.length === 1 && segments[0].kind === "text") return undefined;

      // Replace this text node with the ordered segment nodes.
      const replacement: MdNode[] = [];
      for (const seg of segments) {
        if (seg.kind === "text") {
          replacement.push({ type: "text", value: seg.text });
        } else {
          for (const ref of seg.refs) replacement.push(citeRefNode(ref));
        }
      }
      return replacement;
    });
    return tree;
  };
}
