import type { BuiltTools, ChatRequestContext } from './handler-types';
import type { VerifiedSandboxArtifact } from './sandbox-artifacts';

/** No resource identifiers, provider URLs, credentials or scope selectors. */
export interface ManagedSandboxStatus {
  readonly enabled: boolean;
  readonly available: boolean;
}

/**
 * Server-code-only adapter returned by createHostedSandboxes(). The API key
 * binds the tenant/agent; ctx.userId MUST be verified by getUserId. The handler
 * invokes this only with resolved runtime.sandbox.enabled === true. The API
 * independently checks its published config and operator policy on EVERY call.
 */
export interface ManagedSandboxIntegration {
  readonly kind: 'mordn-managed';
  /** Read-only discovery; never allocates a workspace. */
  status(ctx: ChatRequestContext): Promise<ManagedSandboxStatus>;
  /** Per-turn HTTP connection only; cleanup must never delete the workspace. */
  buildTools(ctx: ChatRequestContext, options: {
    readonly abortSignal: AbortSignal;
    /** Opaque, server-verified artifacts, NOT arbitrary tool JSON or telemetry. */
    readonly onArtifact: (artifact: VerifiedSandboxArtifact) => void;
  }): Promise<BuiltTools>;
}
