# Hosted runtime auth lifecycle

This contract applies to `<ChatWidget publishableKey="pk_live_…" />`, which sends a signed identity-provider token directly to the hosted runtime. It does not change server-route mode (`apiBase`): that route must continue to resolve identity from its verified server session.

## Tell the widget when the session changes

`getUserToken` is read through a ref. Both stable getters and inline functions work; changing the function identity **does not** trigger token resolution on every render. The widget re-asks periodically (every four minutes), but that is token maintenance, not a login/logout subscription.

Pass `authSessionKey?: string | number | null` and change it on **login, logout, or account switch**. Prefer a local incrementing auth-lifecycle counter. Keep it stable during ordinary same-session access-token renewal and unrelated renders. Do not use an access token as the key.

```tsx
// session and authRevision come from your host's auth subscription. Publish
// the updated session and revision together on login/logout/account switch.
<ChatWidget
  publishableKey="pk_live_…"
  authSessionKey={authRevision}
  getUserToken={() => session?.access_token ?? null}
/>
```

On a transition the widget:

1. Stops exposing the previous token and bootstrap scope immediately in the transition render; tears down the mounted conversation UI and its in-memory state.
2. Re-resolves the latest getter. While pending, it does not bootstrap with the previous token **or** send a temporary anonymous visitor request.
3. Bootstraps using the new token (or no token when the getter returns `null`), then mounts a fresh conversation UI using only the opaque storage scope returned by the server.

Getter addition/removal, disabling hosted mode, changing the hosted destination/key, and changing the anonymous policy also invalidate the relevant lifecycle state. An unchanged callback returning a different account cannot be detected immediately without a lifecycle signal.

## Imperative alternative

The existing `ChatWidgetHandle` also exposes `resetAuth(): void`, available in every layout. It is a no-op in server-route mode. It is equivalent to changing `authSessionKey`, even when the resolved token or anonymous visitor id stays the same.

```tsx
const widget = useRef<ChatWidgetHandle>(null);
const sessionSource = useRef<Session | null>(null);

function onSessionChanged(next: Session | null) {
  sessionSource.current = next;
  widget.current?.resetAuth();
}

<ChatWidget
  ref={widget}
  publishableKey="pk_live_…"
  getUserToken={() => sessionSource.current?.access_token ?? null}
/>
```

Update the getter's session source **before** calling `resetAuth()`. If your getter closes over React state, prefer updating that state and `authSessionKey` together rather than calling the ref before the new state has committed. Use one transition mechanism; neither needs to run on every render.

Internally, `useHostedAuth.refresh()` remains a same-session refresh: it retains the current token while resolving. `reset()` is the hard session boundary. Older asynchronous successes and failures cannot overwrite the newest started resolution, and effect cleanup invalidates work on unmount/disable. Stale bootstrap responses are ignored even if fetch/body parsing ignores abort.

## Logout, storage, and limits

- Without `anonymous`, logout sends no user token. The runtime decides whether an unauthenticated request is allowed. With explicit anonymous opt-in (also required on the agent), the widget may resume as the browser's persisted random visitor.
- `authSessionKey` and `resetAuth()` are **not identity assertions**. The key is never sent to the runtime or used to derive a storage scope. Signed tokens are still verified by the server; only the authenticated bootstrap supplies the storage scope.
- Use `getUserToken` for hosted identity; do not put `Authorization` or `X-Mordn-Visitor` into the generic `headers` prop. Generic headers remain host-owned (for example CSRF) and are not an auth-session subscription.
- Reset isolates mounted state but does **not** delete persisted history/drafts. Continue to call the exported `clearChatStorage()` on sign-out/user switch if your policy requires erasing that browser's cached chat data. The anonymous visitor id is intentionally retained.
- Hosts must clear/update their own `conversationId`, `initialMessages`, and other user-specific props on a session change. Reset cannot determine whether caller-supplied content belongs to another account.
- A reset does not revoke tokens or undo requests already received by the server. Getter promises have no cancellation API; obsolete results are ignored. The server must enforce authorization for every request.
- A getter that never settles keeps the widget waiting. There is no new auth timeout or automatic identity-provider subscription.
