/**
 * Pure-logic smoke for the generative-GUI runtime.
 *
 * The registry is blocked in the build sandbox, so this exercises the two
 * decision functions that must be correct for the runtime to be SAFE — the
 * `canRenderGui` allowlist and the built-in dispatcher's client-action routing —
 * as plain JS reimplementations kept in lockstep with the TS source. It asserts
 * the security-critical invariants (unknown kinds don't render, malformed specs
 * don't throw, unsafe URLs are rejected, consequential actions gate on streaming)
 * without needing React or a DOM. Run: `node scripts/gui-runtime-smoke.mjs`.
 */

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', name); }
}

// ── Mirror of canRenderGui (src/components/gui-part.tsx) ──────────────────────
const KNOWN_GUI_KINDS = new Set([
  'action-button', 'action-chips', 'entity-card', 'entity-carousel',
  'action-form', 'selection-group', 'summary-card', 'confirmation-card', 'status-tracker',
]);
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const canRenderGui = (spec) => isRecord(spec) && typeof spec.kind === 'string' && KNOWN_GUI_KINDS.has(spec.kind);

// canRenderGui: known kinds pass, everything else fails safely.
ok('known kind renders', canRenderGui({ kind: 'entity-card', item: { id: '1', title: 'x' } }));
ok('unknown kind does NOT render', !canRenderGui({ kind: 'iframe' }));
ok('null spec does NOT render', !canRenderGui(null));
ok('array spec does NOT render', !canRenderGui([{ kind: 'entity-card' }]));
ok('missing kind does NOT render', !canRenderGui({ item: {} }));
ok('non-object does NOT render', !canRenderGui('entity-card'));
for (const k of KNOWN_GUI_KINDS) ok(`allowlist covers ${k}`, canRenderGui({ kind: k }));

// ── Mirror of safeUrl allowlist (src/utils/url-safety.ts) ─────────────────────
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
function safeUrl(url) {
  if (!url) return undefined;
  const t = String(url).trim();
  if (!t) return undefined;
  if (/^data:/i.test(t)) return undefined; // images handled elsewhere; not for nav
  if (/^blob:/i.test(t)) return t;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return t; // relative
  try { return SAFE_PROTOCOLS.has(new URL(t, 'http://localhost').protocol) ? t : undefined; }
  catch { return undefined; }
}

// ── Mirror of useActionDispatcher client routing (hooks/use-action-dispatcher) ─
const MORDN_CLIENT_ACTIONS = { openUrl: 'mordn.ui.open_url', sendMessage: 'mordn.ui.send_message' };
const isConsequential = (e) => {
  const h = e.action.handler, r = e.action.risk;
  return h === 'server' || h === 'hosted' || r === 'mutation' || r === 'regulated';
};

// Simulate dispatch resolution (host handler → client builtins → server POST).
function simulateDispatch(event, { onAction, isStreaming, canPost }) {
  if (isStreaming && isConsequential(event)) return { routed: 'gated' };
  if (onAction) { const r = onAction(event); if (r) return { routed: 'host', result: r }; }
  const a = event.action;
  const handler = a.handler ?? 'client';
  if (handler === 'client') {
    if (a.type === MORDN_CLIENT_ACTIONS.openUrl) {
      const href = safeUrl(event.values?.url ?? a.payload?.url);
      return href ? { routed: 'open_url', href } : { routed: 'error', code: 'unsafe_url' };
    }
    if (a.type === MORDN_CLIENT_ACTIONS.sendMessage) {
      const text = event.values?.text ?? a.payload?.text;
      return text ? { routed: 'send_message', text } : { routed: 'error', code: 'no_message' };
    }
    return { routed: 'noop' };
  }
  return canPost ? { routed: 'server_post' } : { routed: 'server_post_skipped' };
}

// Consequential actions gate while streaming; UI actions stay live.
ok('server action gated while streaming',
  simulateDispatch({ action: { type: 'lead.capture', handler: 'server' } }, { isStreaming: true }).routed === 'gated');
ok('mutation risk gated while streaming',
  simulateDispatch({ action: { type: 'x', risk: 'mutation' } }, { isStreaming: true }).routed === 'gated');
ok('client open_url NOT gated while streaming',
  simulateDispatch({ action: { type: MORDN_CLIENT_ACTIONS.openUrl, payload: { url: 'https://a.com' } } }, { isStreaming: true }).routed === 'open_url');

// Host handler wins when it returns a result; observing (undefined) falls through.
ok('host handler owns action when it returns a result',
  simulateDispatch({ action: { type: 'x', handler: 'client' } }, { onAction: () => ({ status: 'success' }) }).routed === 'host');
ok('host observer falls through to builtins',
  simulateDispatch({ action: { type: MORDN_CLIENT_ACTIONS.sendMessage, payload: { text: 'hi' } } }, { onAction: () => undefined }).routed === 'send_message');

// Built-in client behaviors + safety.
ok('open_url rejects javascript: URL',
  simulateDispatch({ action: { type: MORDN_CLIENT_ACTIONS.openUrl }, values: { url: 'javascript:alert(1)' } }, {}).routed === 'error');
ok('open_url accepts https',
  simulateDispatch({ action: { type: MORDN_CLIENT_ACTIONS.openUrl }, values: { url: 'https://ok.com' } }, {}).href === 'https://ok.com');
ok('send_message with no text errors',
  simulateDispatch({ action: { type: MORDN_CLIENT_ACTIONS.sendMessage } }, {}).code === 'no_message');
ok('unknown client action no-ops (no host)',
  simulateDispatch({ action: { type: 'custom.thing', handler: 'client' } }, {}).routed === 'noop');

// Server actions POST when apiBase present, skip cleanly when absent.
ok('server action posts when hosted',
  simulateDispatch({ action: { type: 'lead.capture', handler: 'server' } }, { canPost: true }).routed === 'server_post');
ok('server action skips cleanly when headless',
  simulateDispatch({ action: { type: 'lead.capture', handler: 'server' } }, { canPost: false }).routed === 'server_post_skipped');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
