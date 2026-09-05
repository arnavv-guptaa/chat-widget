# Hosted CLI setup: your runtime, mordn infrastructure

Use this path for an existing **Next.js App Router** application. Your route runs inference and tools in your deployment; mordn supplies published agent configuration and hosted persistence/storage services. This is **not** the direct hosted browser runtime (`publishableKey` / `getUserToken`).

## Prerequisites

- A Next.js application with exactly one existing `app/` or `src/app/` directory, a Node server runtime, and React/React DOM already configured. Pages Router, multiple app roots, and automatic framework conversion are not supported.
- An account and **published agent** at [mordn.com](https://mordn.com/sign-up), plus that agent's **server** key.
- A configured, trusted server-side authentication system. The generator deliberately does not guess your provider or manufacture a user identity.
- Model/gateway authentication available to **your** deployment. For the AI SDK default gateway, configure a gateway key (for example `AI_GATEWAY_API_KEY`) or supported deployment authentication. If you override the model, provide the corresponding provider credentials instead. `MORDN_CHAT_KEY` only authenticates mordn services; it is not a model-provider key.

## Run the scaffold

From the application root:

```bash
npm install @mordn/chat-widget ai @ai-sdk/react
npx @mordn/chat-widget init --hosted
```

Equivalent forms:

```bash
npx @mordn/chat-widget init --mode hosted
npx @mordn/chat-widget --hosted
# With the package installed, the bin is named chat-widget:
npx chat-widget init --hosted
```

The CLI itself executes no package install, shell command, migration, or database push. It does not generate Drizzle config, Supabase setup, a database URL, or a model-provider import in hosted mode. The install command above is a separate, explicit action.

### Generated files

For root `app/` projects (all `app/` paths become `src/app/` in source-directory projects):

| File | Purpose |
| --- | --- |
| `app/api/chat/[[...chat]]/route.ts` | `createMordnHandler`, Node runtime, GET/POST/DELETE/OPTIONS, server key requirement |
| `app/api/chat/[[...chat]]/chat-auth.ts` | Fail-closed `getChatUserId` placeholder; returns `null` until implemented |
| `app/mordn-chat.tsx` | Client component exporting `MordnChat`, importing widget CSS, using the default same-origin `/api/chat` |
| `.env.mordn.example` | Blank server credential reference, not a live env file |

The route uses a relative auth import, so no `@/` TypeScript alias is required. No existing layout, page, package manifest, `.env`, `.env.local`, or `.env.example` is modified. The CLI does not accept, read, or print your credentials.

## Finish setup manually

1. Add `MORDN_CHAT_KEY` and gateway/provider settings to your server environment or secret manager. Consult `.env.mordn.example`; **merge individual settings**, never replace an existing env file. Keep secrets out of source control, `NEXT_PUBLIC_*`, client props, and browser bundles. Restart the app after changing env settings. The generated route throws a clear error if its server key is missing.
2. Implement `getChatUserId(request)` in the generated `chat-auth.ts` using your existing session verifier (for example Clerk `auth()` or Auth.js `auth()`). Return a stable id from a **verified server session**, or `null` when signed out. Never trust an id in a browser-controlled header, query parameter, or request body. Never replace the stub with a shared demo identity. Until implemented, protected chat requests return 401.
3. Render the generated client component in your existing layout or page. For a page next to it:

   ```tsx
   import { MordnChat } from './mordn-chat';

   // Add this alongside your existing content; do not replace your page/layout.
   // <MordnChat />
   ```

4. Start your application normally. The published agent supplies model/prompt/client configuration. Optional code-level model or `buildTools` overrides belong in your server route, not client props.

## Conflict and rerun policy

Hosted init checks all output paths before writing. It refuses an existing `app/api/chat` (or `src/app/api/chat`) subtree, even an empty one: existing `route.js`, dynamic routes, or authentication code must not be silently mixed with a new backend. It also refuses existing generated targets, sibling `mordn-chat.js/.jsx/.ts/.tsx` files, symbolic links in target paths (including dangling links), and non-directory parents. An ordinary pre-existing conflict creates **no scaffold files** and exits nonzero. There is no overwrite/force prompt.

For an existing integration or rerun, keep your files and merge the [manual hosted quickstart](../README.md#hosted-quickstart) after reviewing your routing and auth boundary. Do not delete existing app files just to make the wizard proceed. Permission errors or a filesystem change during writing can leave some **new** scaffold files; exclusive creation still refuses existing target files. Review any partial scaffold manually rather than assuming setup completed. Do not run concurrent generators against the same project.

Bare `npx @mordn/chat-widget` / `init` still chooses the legacy **self-managed** scaffold for compatibility. `--mode self-hosted` is explicit. That path reports skipped existing/unsafe files and exits nonzero instead of overwriting them; its database/storage instructions do not apply to hosted mode. Unknown options, unknown modes, and contradictory modes fail before creating files. `--help` prints usage without scaffolding.

## Verify before deploying

- With a valid server key but the untouched auth stub, protected requests are rejected; no demo identity is granted.
- Signed out: protected chat operations return 401. Signed in: bootstrap resolves your published agent and a complete chat turn streams successfully using your deployment's model credentials.
- Reload: conversation history is restored. Switch accounts: a second verified user cannot access the first user's conversations or attachments.
- Browser/network inspection: no `MORDN_CHAT_KEY`, gateway/provider secret, or browser-asserted `userId` is present in widget configuration.
- Validate deployment timeout limits for streaming/tool calls (`maxDuration = 300` is a request to the platform, not a guarantee).

The generator does not log in, verify your key, publish an agent, check gateway billing/access, or run a real model call. Those production checks remain your responsibility.
