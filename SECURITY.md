# Security model

This document explains how `@mordn/chat-widget` keeps one user's
conversations and attachments private from another's, and the one thing **you**
must do to uphold it.

## TL;DR

- **You establish identity on the server.** You implement `getChatUserId(req)`
  to return the user id from your *verified* server session.
- **The widget exposes no client identity prop or identity header.** Never add
  one as an authentication shortcut; browser-controlled identity is forgeable.
- **The package enforces the rest.** Conversation ownership, per-user data
  scoping, private attachments, and signed URLs are handled inside the package
  and are not your responsibility to wire up correctly.

## The threat we designed against: IDOR

IDOR — *Insecure Direct Object Reference* — is when a server uses a
client-supplied identifier to fetch data **without checking the requester owns
it**. For a chat product the identifier is the user id (and the conversation
id). If a route does this:

```ts
// ❌ NEVER do this
const userId = req.headers.get('X-User-Id');     // browser controls this
return getConversations(userId);                  // returns anyone's chats
```

…then any user can read or write any other user's conversations by changing a
header. This is the single most important class of bug for a multi-user chat
app, and it is easy to introduce by accident.

## How the package prevents it

### 1. Identity comes from your server session — `getChatUserId`

`createChatHandler` calls **your** `getChatUserId(request)` and uses whatever it
returns as the only identity for the request. Implement it against your auth
system's *server-verified* session:

```ts
// ✅ Clerk
import { auth } from '@clerk/nextjs/server';
export async function getChatUserId() {
  const { userId } = await auth();
  return userId;            // from a verified session cookie/JWT
}
```

The `request` is passed in so you can read **verified** cookies — not so you can
read a client-asserted id. Returning a value derived from `req.headers`,
`req.url` query params, or the JSON body re-introduces the IDOR. The scaffolded
stub **throws until you implement it**, so a fresh install is never silently
insecure.

### 2. The data layer is bound to one user — IDOR is unrepresentable

Internally, the store and storage adapters are **constructed bound to the
verified `userId`**. None of their methods accept a user id. There is no
parameter through which a foreign id could enter, so "fetch user B's data while
acting as user A" cannot be expressed in the code at all — it's a type-level
guarantee, not a convention you have to remember.

- `getConversation(id)` returns `null` when the conversation exists but belongs
  to another user — indistinguishable from "not found", so existence can't be
  probed.
- Creating/writing a conversation that belongs to another user is rejected
  (HTTP 403) before anything is persisted.
- Listing and message reads are implicitly scoped to the bound user.

### 3. Attachments are private by default

The default storage adapter:

- writes to a **private** bucket (never a public URL),
- returns **short-lived signed URLs**, re-signed on demand when old
  conversations are reloaded,
- stores files under **user-namespaced, unguessable paths** derived from the
  bound user id, and refuses to sign or delete anything outside that namespace.

The bucket you create **must be private**. The adapter never relies on public
read; if you make the bucket public you reopen a hole the package otherwise
closes.

## Your responsibilities checklist

- [ ] Implement `getChatUserId` to return the id from your **server** session.
- [ ] Never read identity from `X-User-Id`, query params, or the request body.
- [ ] Create the attachments bucket as **private** (if you keep uploads).
- [ ] Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only (never `NEXT_PUBLIC_`).

If you bring your own `ChatStore` or `StorageAdapter`, uphold the invariants
documented on those interfaces — they are the security boundary for the custom
path.

## Reporting a vulnerability

Please open a private report at
<https://github.com/arnavv-guptaa/chat-widget/security/advisories> rather than a
public issue.
