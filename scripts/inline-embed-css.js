#!/usr/bin/env node
/**
 * Inline the widget's stylesheet into the script-tag IIFE bundle.
 *
 * WHY THIS EXISTS
 * ---------------
 * The widget's CSS is produced by a pipeline that runs AFTER tsup:
 *
 *   tsup  →  @tailwindcss/cli (writes dist/styles.css)  →  scope-css.js
 *            (scopes every rule to .chat-widget-container and unlayers it)
 *
 * Because the CSS does not exist when tsup runs, tsup cannot bundle it into the
 * embed. But the whole promise of the script-tag embed (issue #192) is a SINGLE
 * artifact with zero extra requests and no framework — so the styles must ride
 * inside `dist/embed.global.js` itself, not as a separate file the host has to
 * remember to load.
 *
 * The embed source (`src/embed/index.tsx`) therefore holds a placeholder string
 * literal, `"__MORDN_WIDGET_CSS__"`. This script — the LAST step of the build
 * chain, after scope-css.js — reads the finished, already-scoped stylesheet and
 * rewrites the bundle, replacing that placeholder with the CSS as a JS string
 * literal. At runtime the embed injects it once into a `<style>` tag.
 *
 * WHY A PLAIN NODE SCRIPT (no deps): mirrors scope-css.js — the build chain must
 * stay dependency-light and runnable in CI without an install step beyond the
 * package's own devDependencies.
 *
 * IDEMPOTENT + SAFE TO SKIP: if the placeholder isn't found (e.g. the bundle was
 * already processed, or a future refactor renamed it) we log and exit 0 rather
 * than failing the build — the embed has a runtime fallback that links the
 * published stylesheet from a CDN, so a missed inline degrades gracefully. We
 * only hard-fail when an input file is missing, which means the build chain
 * itself ran out of order.
 */

const fs = require('fs');
const path = require('path');

// Both paths resolve from THIS script's directory, exactly like scope-css.js,
// so the build works regardless of the process cwd (npm scripts, CI, etc.).
const cssPath = path.join(__dirname, '../dist/styles.css');
const bundlePath = path.join(__dirname, '../dist/embed.global.js');

// The placeholder literal as it appears in src/embed/index.tsx. esbuild emits
// string literals with double quotes in minified output, but we also match
// single quotes and unquoted occurrences defensively so a tooling change can't
// silently leave the placeholder un-inlined.
const PLACEHOLDER = '__MORDN_WIDGET_CSS__';

function fail(msg) {
  console.error(`✗ inline-embed-css: ${msg}`);
  process.exit(1);
}

// ── Inputs ───────────────────────────────────────────────────────────────────
// A missing input means the build ran out of order (this step must come AFTER
// tsup produced the bundle and AFTER the Tailwind CLI + scope-css.js produced
// the stylesheet). That is a real build error — fail loudly.
if (!fs.existsSync(bundlePath)) {
  fail(
    `bundle not found at ${bundlePath}. This step must run AFTER \`tsup\` emits ` +
      `the embed IIFE. Check the build script order in package.json.`
  );
}
if (!fs.existsSync(cssPath)) {
  fail(
    `stylesheet not found at ${cssPath}. This step must run AFTER the Tailwind ` +
      `CLI and scope-css.js. Check the build script order in package.json.`
  );
}

const css = fs.readFileSync(cssPath, 'utf8');
let bundle = fs.readFileSync(bundlePath, 'utf8');

// ── Substitution ─────────────────────────────────────────────────────────────
// Replace the WHOLE string literal (quotes included) with a freshly serialized
// one. `JSON.stringify(css)` yields a valid double-quoted JS string literal with
// every quote, backslash, newline, and control char escaped — safe to splice
// straight into JS source. Replacing the bare token instead would leave the
// original surrounding quotes dangling and corrupt the bundle, so we match the
// quoted forms explicitly.
const cssLiteral = JSON.stringify(css);

// Count occurrences first so we can report and detect the "nothing to do" case.
// The placeholder may appear more than once if esbuild inlined the single-use
// `const` at its use sites — that is expected; we replace them all.
const quotedDouble = `"${PLACEHOLDER}"`;
const quotedSingle = `'${PLACEHOLDER}'`;

let count = 0;
if (bundle.includes(quotedDouble)) {
  count += bundle.split(quotedDouble).length - 1;
  bundle = bundle.split(quotedDouble).join(cssLiteral);
}
if (bundle.includes(quotedSingle)) {
  count += bundle.split(quotedSingle).length - 1;
  bundle = bundle.split(quotedSingle).join(cssLiteral);
}

if (count === 0) {
  // Not fatal: the runtime CDN fallback covers this. But it is unexpected on a
  // normal build, so make it visible.
  console.warn(
    `⚠ inline-embed-css: placeholder "${PLACEHOLDER}" not found in ` +
      `dist/embed.global.js — leaving the bundle untouched (runtime CDN CSS ` +
      `fallback will apply). If you expected inlining, verify the embed entry ` +
      `built and still references the placeholder.`
  );
  process.exit(0);
}

// Belt-and-suspenders: after substitution the bare token must not survive
// anywhere in the bundle (it would mean an occurrence in an unexpected quoting
// form). If it does, fail so the pre-merge grep check can't be the first to
// catch it.
if (bundle.includes(PLACEHOLDER)) {
  fail(
    `placeholder "${PLACEHOLDER}" still present after substitution — an ` +
      `occurrence used an unexpected quoting form. Inspect dist/embed.global.js.`
  );
}

fs.writeFileSync(bundlePath, bundle);

const kb = (Buffer.byteLength(css, 'utf8') / 1024).toFixed(1);
console.log(
  `✓ inline-embed-css: inlined ${kb} KB of scoped CSS into ` +
    `dist/embed.global.js (${count} placeholder occurrence${count === 1 ? '' : 's'})`
);
