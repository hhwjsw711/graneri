# Architecture

Graneri is desktop-first and web-supported. `apps/desktop` packages the Vite
renderer from `apps/web` and talks to Convex for backend state and AI actions.

This document is the system of record for runtime boundaries and release
invariants. Update it only when a boundary, packaging rule, release
configuration path, or Convex integration contract changes.

## Ownership

`apps/desktop`
: Electron main, preload, IPC, native permissions, capture helpers, local
server, packaging, updater behavior, and desktop release configuration.

`apps/web`
: React renderer for both desktop and browser. Desktop releases still depend on
the Vite bundle, so renderer constants are part of desktop release correctness.

`packages/platform`
: The only renderer-safe package that may read `window.graneriDesktop`.
Renderer code must access desktop capabilities through this package.

`packages/ai`
: Shared AI runtime code. It must not import Convex server modules or
`convex/*.ts`; server-only behavior must enter through adapters or Convex
client/action boundaries.

`convex/`
: Server functions, schema, HTTP actions, auth, and server-only integrations.
Read `convex/_generated/ai/guidelines.md` before changing Convex code.

## Release Configuration

Official packaged desktop builds must embed public hosted URLs in both runtime
layers:

- Electron main/runtime config:
  `apps/desktop/dist/hosted-runtime-config.mjs`
- Vite renderer constants: `apps/web/dist`

Electron main and the packaged Vite renderer must point at the same hosted
Convex deployment.

Hosted URLs are public configuration, not secrets. They identify hosted Convex
and web deployments. Never embed `OPENAI_API_KEY`, `BETTER_AUTH_SECRET`, OAuth
client secrets, deploy keys, or signing credentials into desktop builds.

Official builds pass:

```sh
GRANERI_HOSTED_CONVEX_URL=https://<prod-deployment>.convex.cloud
GRANERI_HOSTED_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
GRANERI_HOSTED_SITE_URL=https://<hosted-app-origin>
```

Local development builds stay local. `bun dev` and desktop dev runs load local
runtime values and connect to the development Convex deployment.

## Desktop AI

The desktop local server owns renderer-facing AI HTTP routes:

- `/api/chat`
- `/api/apply-template`
- `/api/enhance-note`
- `/api/realtime-transcription-session`

Packaged desktop apps must not embed `OPENAI_API_KEY`. If hosted Convex/site
config is present and no process-local OpenAI key exists, the desktop local
server proxies AI routes to the hosted Convex site URL. Release behavior must
not depend on terminal-inherited shell environment.

Local-folder chat uses a hosted-model, desktop-tool bridge:

1. Hosted Convex owns the OpenAI key and model loop.
2. Hosted Convex declares local folder tools without server-side executors.
3. The desktop renderer receives client-side local tool calls.
4. The renderer executes those calls through the desktop local server against
   folders explicitly shared through the desktop bridge.
5. The renderer attaches tool output and lets the AI SDK resubmit the
   conversation to hosted Convex.

Client-side local tool outputs must resubmit with the same chat request body,
including `localFolders`, so subsequent hosted model steps keep the same desktop
tool context.

Hosted handlers must never claim direct access to the user's Mac filesystem.
Desktop-local capabilities must fail visibly when the desktop bridge contract is
unavailable. Local path references must be registered through
`shareLocalFolders` before they reach `/api/chat`, or request preparation must
fail with an actionable error.

On macOS, live transcription must use the desktop transcription controller. It
must not silently fall back to the browser transcription controller when the
packaged desktop bridge is missing or stale.

Proxy response handling must match the body strategy. Streamed routes may pipe
the upstream body with upstream headers. Buffered or decoded proxy responses
must emit fresh body headers and must not forward stale `content-encoding`,
`content-length`, or `transfer-encoding`.

## Desktop Runtime

Desktop tray state belongs to Electron, but it must mirror the renderer's active
account, workspace, calendar connection state, and calendar display preferences.
Renderer changes to calendar state should notify Electron to refresh the tray.

Electron Builder packages dependencies from `apps/desktop/package.json`. Any
package imported by packaged desktop runtime code through `apps/desktop`,
`packages/ai`, or copied runtime modules must be declared there.

The desktop build copies runtime source into `.bundle-root`. Packaged runtime
code must not rely on source-tree imports outside `.bundle-root`.

## Required Verification

After building the desktop package, run:

```sh
bun --filter=desktop run verify:package
```

The verifier must fail if:

- `app.asar` contains a stale development Convex deployment.
- `app.asar` misses the expected hosted Convex deployment.
- The bundled renderer contains stale dev Vite constants.
- Packaged runtime code imports Convex server TypeScript.
- Bare package imports in `.bundle-root` cannot resolve from packaged
  `node_modules`.

## Enforcement

`bun run check`, `bun run typecheck`, targeted tests, and
`bun --filter=desktop run verify:package` enforce this document's invariants.

Repeated architecture failures should become scripts, lint rules,
package-boundary checks, or tests instead of more prose.
