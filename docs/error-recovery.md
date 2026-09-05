# Typed error recovery

The widget carries versioned, allowlisted error metadata separately from human text. It is a presentation hint, never authorization or permission to repeat a side effect.

## Wire contract

Streaming responses emit a transient `data-chat-error` event before the ordinary AI SDK error event. Data contains `version: 1`, `kind`, `retryable`, and optional `retryAfterMs`/opaque `traceId`. HTTP failures preserve their existing status/body and expose JSON metadata through `x-chat-error` (included in configured CORS exposed headers).

Kinds: abort, rate_limit, auth, transient, content_policy, prompt, model, tool, unknown. Only rate_limit/transient metadata can enable manual retry. Retry hints are capped at fifteen minutes. The metadata never includes provider text, payloads, stacks or secrets.

New clients associate each response stream with its own error. An older stopped response cannot label the next response's error. Unknown protocol versions/malformed metadata use the legacy safe-text fallback. Old clients still receive the existing ordinary error text.

## Client integration

`ChatWidget` configures recovery automatically. Custom clients can import `createChatErrorRecovery`, wrap a `DefaultChatTransport` using `recovery.wrapTransport(transport)`, and supply `recovery.fetch` as that transport's fetch option for HTTP metadata. Use `getChatErrorRecovery(error)` to inspect safe metadata for the exact Error. Do not share the low-level onData/onError accumulator between streams; `wrapTransport` provides the isolation needed by a Chat with overlapping/cancelled requests.

The banner uses typed kind/retry policy rather than English-message equality when metadata exists. Delay expiry enables an explicit manual Retry click; it never issues a request automatically. Tool errors, auth/policy failures and unknown errors do not gain automatic retries. A retryable transport error is not proof that previously executed external actions can be repeated safely.

## Stop versus timeout

A user stop remains a partial answer without an error banner. The handler's configured wall-clock timeout is a visible transient failure. Upstream abort-shaped errors that were not caused by the handler's own stop signal remain visible failures. Aborted partial-turn persistence still uses the SDK abort marker.

## Persistence and authority

`data-chat-error` is reserved transient control data. The widget drops non-transient variants, and the server rejects browser messages that include it. Never persist raw stream events as transcript content. Metadata is not forwarded as model instructions and cannot approve tools or override server policy.

Host `onError` callbacks remain trusted server code and must return safe public text. They retain the existing callback contract; a throwing callback falls back to package-owned copy. New-client presentation may select localized/package-owned copy from the error kind rather than display a custom callback's prose.

## Verification boundary

Tests cover parser projection, delayed manual retry, per-stream association, HTTP failures, user-stop/timeout distinctions and SDK stream behavior with an in-memory model. Live provider/network cancellation and browser integration need release verification; no provider billing guarantee follows from this protocol.
