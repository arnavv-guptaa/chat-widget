#!/usr/bin/env node
/**
 * Post-process Tailwind CSS to scope ALL selectors to .chat-widget-container
 * This prevents our styles from leaking into the host application.
 */

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '../dist/styles.css');

let css = fs.readFileSync(cssPath, 'utf8');

// Replace :root,:host with the OUTERMOST .chat-widget-container only. The
// widget nests a second .chat-widget-container (the interface root) inside the
// layout wrapper; if token defaults (--chat-primary etc.) re-declared there,
// they would shadow runtime overrides set inline on the outer wrapper (the
// theme.primaryColor no-op bug). :where() keeps specificity at (0,1,0) so host
// `.chat-widget-container { --chat-*: … }` theming overrides still win.
const ROOT_SCOPE = '.chat-widget-container:where(:not(.chat-widget-container *))';
css = css.replace(/:root,:host\{/g, `${ROOT_SCOPE}{`);
css = css.replace(/:root\{/g, `${ROOT_SCOPE}{`);
css = css.replace(/:host\{/g, `${ROOT_SCOPE}{`);

// Scope the global * selector to only apply within our container
css = css.replace(
  /\*,:before,:after,::backdrop\{/g,
  '.chat-widget-container,.chat-widget-container *,.chat-widget-container :before,.chat-widget-container :after{'
);

// Now scope ALL utility class selectors to only work inside .chat-widget-container
// This is the key fix - utilities like .flex, .hidden, etc. need to be scoped

// Split by @layer to handle each section
const parts = css.split(/(@layer\s+[\w-]+\s*\{)/g);

let result = '';
for (let i = 0; i < parts.length; i++) {
  const part = parts[i];

  // If this is a @layer chat-widget block, scope all selectors inside it
  if (part.match(/@layer\s+chat-widget\s*\{/)) {
    result += part;
    // Get the content of this layer (next part)
    if (i + 1 < parts.length) {
      i++;
      let layerContent = parts[i];

      // Scope class selectors: .classname{ -> .chat-widget-container .classname{
      // But don't double-scope .chat-widget-container itself.
      //
      // The body char class MUST include `\\` so that Tailwind's escape
      // sequences are consumed: e.g. `.top-1\/2`, `.left-\[50\%\]`, `.\!w-full`
      // would otherwise terminate the match at the first backslash and silently
      // leave the selector unscoped — leaking those utilities to the host page.
      // First-char also allows `\\` for classes that begin with an escape
      // (e.g. `.\!important-prefixed-classes`).
      layerContent = layerContent.replace(
        /(?<=[,\{\}]|^)\s*\.(?!chat-widget-container)([a-zA-Z_\-\\][\w\-\[\]\(\)\.\:\/%,\s\*\>\+\~\#\=\'\"\^\$\\]*?)\{/g,
        '.chat-widget-container .$1{'
      );

      result += layerContent;
    }
  } else {
    result += part;
  }
}

// ── Unlayer everything ───────────────────────────────────────────────────────
// The widget's CSS must be SELF-CONTAINED: it should win against any host app's
// CSS regardless of the host's resets, Tailwind layers, or stylesheet load order.
//
// Tailwind v4 emits our rules inside `@layer chat-widget` (+ chat-widget-base,
// properties). But per the CSS cascade, UNLAYERED styles always beat LAYERED
// ones — so a host's unlayered preflight (`*{border-width:0}`, element resets)
// silently overrides every layered widget rule, and the widget renders unstyled.
// (It only "worked" in some hosts by accident of <head> stylesheet order.)
//
// Fix: strip the @layer wrappers so our rules become unlayered. They're already
// scoped to `.chat-widget-container`, so they now win on SPECIFICITY instead:
// `.chat-widget-container .border` (0,2,0) beats a host `*{border-width:0}`
// (0,0,0) and a host `.border` (0,1,0). This is immune to host resets, layer
// config, AND load order. Safe because the widget ships no preflight of its own
// (styles.src.css imports only tailwindcss/theme + /utilities), so the layers
// carry no internal ordering we depend on. Theming via the documented `--chat-*`
// CSS variables is unaffected (custom-property inheritance ignores layers).
function stripLayers(input) {
  let out = '';
  let i = 0;
  while (i < input.length) {
    const m = /@layer\s+[\w-]+\s*\{/.exec(input.slice(i));
    if (!m) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, i + m.index); // text before the layer opener
    let depth = 1;
    let k = i + m.index + m[0].length; // first char inside the layer
    let body = '';
    for (; k < input.length && depth > 0; k++) {
      const ch = input[k];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
      body += ch;
    }
    out += stripLayers(body); // recurse: unwrap nested layers too
    i = k + 1; // skip past the matched close brace
  }
  return out;
}

result = stripLayers(result);

// Write the scoped, unlayered CSS back
fs.writeFileSync(cssPath, result);

console.log('✓ All CSS scoped to .chat-widget-container and unlayered (host-independent)');
