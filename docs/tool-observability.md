# Per-tool execution telemetry

The chat handler sends payload-free tool observations to the existing `ChatLogger`.
`logErrors: false` still selects the no-op logger unless an explicit logger is supplied.
Tool telemetry uses the same trace and conversation correlation as the turn logs,
plus a fresh `turnId` per authenticated chat request. Two concurrent requests can
share a gateway trace, conversation and tool-call ID without merging their logs.

## Events

| Event | Level | Meaning |
| --- | --- | --- |
| `tool.start` | info | The SDK is about to invoke a server tool's `execute`. `outcome: started`. |
| `tool.finish` | info | The SDK finished execution, including exhausting an async generator. `outcome: success`. |
| `tool.error` | warn | Execution threw/rejected, including during generator iteration. `outcome: error`, `kind: tool`. |
| `tool.call` | info | A provider or external tool call appeared in the model stream. `outcome: observed`; **not proof of execution or completion**. |

All tool events carry `traceId`, `turnId`, `conversationId`, verified `userId`,
`toolCallId`, `toolName` and `executionLocation`. Execution events also carry the
SDK's zero-based `stepNumber` when supplied. Approved calls resumed from earlier
messages may execute before a numbered step and omit that field. Terminal
execution events use the SDK's `durationMs`, not the time since a model emitted
input. Invalid timing values are omitted rather than replaced with guesses.
Duplicate server notifications are deduplicated per `(stepNumber, toolCallId)`
within a turn; external/provider observations are deduplicated per tool-call ID.
A finish notification received without a start is recorded without fabricating a
start. Deduplication does not suppress the SDK's actual execution or alter results.

`success` means the SDK's execute contract completed, **not** that a remote
business operation succeeded. A tool that returns an error-shaped object instead
of throwing still completed its execute contract. Telemetry never inspects output
to infer a business result.

## Server, client and provider boundaries

- `server`: only execution hooks generate lifecycle events. This includes host,
  knowledge-retrieval and MCP-backed tools: remote MCP IO is invoked by server
  `execute`, and the existing namespaced tool name identifies the tool. No remote
  URL, headers, arguments or response content are copied into telemetry.
- `provider`: `providerExecuted: true` on a model tool-call chunk. This path emits
  only `tool.call`; provider execution is not timed by server execution hooks.
- `external`: no server execute function exists. This can mean client-side work,
  deferred work, an unavailable tool, or an intentionally schema-only tool. The
  server cannot prove the browser ran it, so this is **not labelled client success**.
  Client completion would require a separate trusted client-observability path.
- Approval-pending/denied calls and invalid inputs do not execute, so they do not
  get fabricated starts, finishes or tool-execution failures. Input/validation
  and approval audit events are separate concerns. Client transcript status in
  `toolRegistry` is not used as server execution evidence.

## SDK seam and compatibility

The implementation uses `streamText.experimental_onToolCallStart` and
`experimental_onToolCallFinish`, plus `onChunk` for external/provider observations.
It neither replaces tools nor wraps `execute`, and does not alter signatures,
`this`, input hooks, provider options/metadata, approval decisions, or async
iterators. Existing error transport, cleanup, persistence and token accounting
are unchanged. No SDK OpenTelemetry input/output recording is enabled.

This seam was statically checked against the repository's locked **ai@6.0.175**:

- [streamText callback options](https://github.com/vercel/ai/blob/ai%406.0.175/packages/ai/src/generate-text/stream-text.ts)
- [execution and generator handling](https://github.com/vercel/ai/blob/ai%406.0.175/packages/ai/src/generate-text/execute-tool-call.ts)
- [approval and provider-execution gates](https://github.com/vercel/ai/blob/ai%406.0.175/packages/ai/src/generate-text/run-tools-transformation.ts)

The callbacks are **experimental**. The package requires `ai: ^6.0.175`, the
repository's locked and source-reviewed minimum. This is a conservative supported
floor, not a claim that 6.0.175 first introduced the hooks. The former `^6.0.0`
range admitted older builds without these callbacks, silently losing server
lifecycle events. Original consumer locks resolve 6.0.208 (web) and 6.0.235 (API),
which meet the new floor; remote CI must still verify both. There is deliberately
no signature-changing wrapper fallback. Exported callback types are derived from `streamText` so SDK
contract changes surface in the source typecheck rather than a parallel local
shape silently drifting.

## Privacy and logger failures

Only the explicitly listed identifiers and scalar lifecycle fields are logged.
Arguments, results, prompts/messages, provider metadata, execution context,
raw errors, error messages, names, stacks and codes are not read or copied by
the telemetry helper. `kind: tool` is a conservative fixed taxonomy value; this
patch does not guess error categories from arbitrary tool prose. Hosts should
still avoid putting secrets in tool names or IDs and apply their own identifier
retention policies.

Synchronous logger throws and asynchronous logger rejections remain contained by
`createTurnLogger`. Sinks must still be non-blocking: a synchronous expensive log
implementation can delay execution. Pre-existing non-tool log sites have their
own contracts; this is not a claim that every existing log in the package is
payload-free.

## Verification and remaining work

Authored tests:

- `test/tool-observability.test.ts`: exact field allowlist, duplicates, out-of-order
  concurrent calls, repeated IDs across steps/turns, orphan finishes, hostile
  errors, invalid duration, logger throw/rejection, non-executing observations,
  and tool identity/approval/provider-option preservation.
- `test/tool-observability-sdk.test.ts`: real SDK + in-memory model (no external
  provider), execution ordering/options/metadata, parallel success/error,
  generators that finish/throw after a preliminary yield, schema-only/missing/
  invalid tools, pending/resumed/denied approvals, provider tools, logger failures,
  and handler correlation across concurrent requests.
- Existing `test/observability.test.ts` remains the logging/trace regression suite.

Suggested CI command (not executed during this no-local-compile task):

```sh
npm test -- test/observability.test.ts test/tool-observability.test.ts test/tool-observability-sdk.test.ts
```

These tests were authored and source-reviewed, not run locally. Run the source
typecheck and focused/full tests in the authorized CI lane before merging.
Live provider/MCP/browser tests remain necessary. In particular this patch does
**not** establish cancellation completion, abort-token accounting, final usage,
or transport delivery on client disconnect. A start may remain unmatched if
execution never settles or the runtime dies; no cleanup/abort/turn-finish path
invents a terminal tool outcome. An execute function that ignores abort and later
returns may still generate a real finish notification. Closing those abort and
usage questions requires live runtime evidence, not simulated success records.
