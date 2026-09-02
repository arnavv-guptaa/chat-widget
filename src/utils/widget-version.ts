/**
 * The published package version, injected at build time via tsup `define`
 * (`__MORDN_WIDGET_VERSION__`, read from package.json at config-eval time so
 * it never drifts from the release). Under vitest / a raw TS import the define
 * is absent and we fall back to a recognisable dev marker.
 *
 * Used to advertise this build to the control plane
 * (`X-Mordn-Widget-Version` on hosted requests) so the server can reason about
 * what this deployment understands — see docs/config-evolution.md.
 */
declare const __MORDN_WIDGET_VERSION__: string | undefined;

export const WIDGET_VERSION: string =
  typeof __MORDN_WIDGET_VERSION__ === 'string' && __MORDN_WIDGET_VERSION__.length > 0
    ? __MORDN_WIDGET_VERSION__
    : '0.0.0-dev';
