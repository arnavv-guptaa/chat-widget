import type { MessagePartRenderers } from '../../src/types';
// In a host app, import the type from '@mordn/chat-widget' instead.

interface AccountLookupResult {
  name: string;
  accountId: string;
  plan: string;
}

function isAccountLookupResult(value: unknown): value is AccountLookupResult {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.name === 'string' && typeof data.accountId === 'string' &&
    typeof data.plan === 'string';
}

/** Display-only snapshot. This card does not grant access or execute actions. */
function AccountLookupCard({ account, streaming }: { account: AccountLookupResult; streaming: boolean }) {
  return (
    <section
      aria-label="Account lookup result"
      aria-busy={streaming}
      style={{
        border: '1px solid hsl(var(--chat-border))',
        borderRadius: 12,
        padding: 16,
        color: 'hsl(var(--chat-text))',
        background: 'hsl(var(--chat-background))',
        overflowWrap: 'anywhere',
      }}
    >
      <strong>{account.name}</strong>
      <dl style={{ marginBottom: 0 }}>
        <dt style={{ color: 'hsl(var(--chat-text-muted))' }}>Account</dt>
        <dd style={{ marginLeft: 0 }}>{account.accountId}</dd>
        <dt style={{ color: 'hsl(var(--chat-text-muted))' }}>Plan</dt>
        <dd style={{ marginLeft: 0 }}>{account.plan}</dd>
      </dl>
    </section>
  );
}

// Stable module-level map: no new renderer identities on every streaming tick.
export const accountLookupRenderers = {
  'data-account-lookup': (part, context) => {
    // Role is presentation context, NOT proof of an authorized server result.
    if (context.role !== 'assistant' || !isAccountLookupResult(part.data)) return null;
    return <AccountLookupCard account={part.data} streaming={context.isStreaming} />;
  },
} satisfies MessagePartRenderers;
