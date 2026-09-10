const errorKey = Symbol.for('@mordn/chat-widget/sandbox-unavailable/v1');

/** Safe setup failure; no model or sandbox tool execution on this path. */
export class ManagedSandboxUnavailableError extends Error {
  readonly code = 'MANAGED_SANDBOX_UNAVAILABLE';
  readonly status = 503;
  constructor(message = 'Managed sandboxes are unavailable. No sandbox tool was run. Try again later or contact the agent owner.') {
    super(message);
    this.name = 'ManagedSandboxUnavailableError';
    Object.defineProperty(this, errorKey, { value: true });
  }
}

/** Recognizes independently bundled public entry points; JSON cannot brand errors. */
export function isManagedSandboxUnavailableError(error: unknown): error is ManagedSandboxUnavailableError {
  return error instanceof Error && (error as unknown as Record<symbol, unknown>)[errorKey] === true;
}
