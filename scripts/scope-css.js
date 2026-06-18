#!/usr/bin/env node
/**
 * Post-process Tailwind CSS to scope ALL selectors to .chat-widget-container
 * This prevents our styles from leaking into the host application.
 */

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '../dist/styles.css');

let css = fs.readFileSync(cssPath, 'utf8');

// Replace :root,:host with .chat-widget-container
css = css.replace(/:root,:host\{/g, '.chat-widget-container{');
css = css.replace(/:root\{/g, '.chat-widget-container{');
css = css.replace(/:host\{/g, '.chat-widget-container{');

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

// Write the scoped CSS back
fs.writeFileSync(cssPath, result);

console.log('✓ All CSS scoped to .chat-widget-container');
