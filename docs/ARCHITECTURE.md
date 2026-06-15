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
client/action boundaries. Imports from `convex/_generated` are allowed only for
typed client function references and generated data-model types, not server
implementation coupling. Hosted chat helpers own shared run-plan assembly,
prompt construction, branch preparation, tool-loop setup, message persistence
payloads, and active-stream persistence behavior; callers provide
runtime-specific reads, writes, request transport, and desktop-local
capabilities through small adapter callbacks.
Hosted chat runs are durable Convex lifecycle records. `assistantRuns` owns run
state, stop/failure/completion history, and the one-active-run-per-chat
invariant. `chatActiveStreams` and active `chatToolCalls` are temporary render
snapshots scoped to a run; terminal runs must leave no stream or active tool
snapshots behind. These records do not move desktop-local tool execution out of
the renderer/local-server bridge.
AI SDK stream resume must attach to a non-terminal `assistantRuns` record and a
live in-process producer. It must not infer lifecycle from partial stream text.
If Convex has an attachable run but the current process has no matching producer,
the run fails and temporary snapshots are cleaned up rather than returning a
synthetic stream. Resume request preparation must fail when required workspace
or authentication state is unavailable; it must not fall back to the normal chat
send endpoint.
Human-blocking assistant work uses `waiting_for_user` plus a typed
`pendingDecision` on the run. Producers must resume the same run after the
decision instead of creating a second active run. Normal duplicate sends must
reject before persisting a new user message when a chat already has a
non-terminal run; regenerate is the explicit supersede path. Stop requests are
idempotent at the HTTP boundary: no attachable run means there is nothing left
to stop, so the route may return success without creating synthetic run state.
Follow-up queueing is durable run state, not UI-local buffering.
`assistantQueuedMessages` stores queued user messages and request context scoped
to the active run. Completed runs leave queued follow-ups for the client drain
path, which claims the next queued item only after no non-terminal run remains
for the chat. Stop, failure, and supersede cleanup may discard still-queued work
for that run. If a producer fails before handing a claimed item to the chat
transport, it must requeue the item rather than losing it. Durable queued
request state must not persist desktop-local folder scope or absolute paths;
follow-ups that need local-folder tools must wait for the current run to finish.

Connected app AI capabilities are declared in
`packages/ai/src/capability-registry.mjs`. The registry is the source of truth
for provider identity, source instructions, tool-discovery prefixes, and tool
builders. Desktop-local capabilities such as shared local folders and native
transcription remain desktop bridge APIs, not generic connected-app
capabilities.

`convex/`
: Server functions, schema, HTTP actions, auth, and server-only integrations.
Read `convex/_generated/ai/guidelines.md` before changing Convex code.

## Release Configuration

Official packaged desktop builds must embed public hosted URLs in both runtime
layers:

- Electron main/runtime config:
  `apps/desktop/dist/hosted-runtime-config.mjs`, bundled into
  `dist-electron/main/index.js`
- Vite renderer constants: `apps/web/dist`, copied into packaged `dist-app`

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

Global dictation is a desktop-native capability, not a renderer textarea
feature. The desktop runtime owns the global hotkey monitor, microphone capture,
buffered AI SDK transcription, and system paste into the focused app. Renderer
code must not duplicate dictation capture or expose route-level fallbacks for
this path.

Desktop realtime transcription is a long-lived native capture session. Starting
the microphone transport must schedule the realtime session rollover, and
stopping a transport must only commit the OpenAI input audio buffer when there
is a known live realtime item to finalize. Empty-buffer commits are not a valid
stop path; they create recoverable-looking OpenAI errors that can collapse into
start/stop loops.

Meeting-controlled and idle-controlled automatic stops must be modeled as
explicit transcription auto-stop state in the renderer, not scattered hook
refs. A newly auto-started note must not inherit stale meeting-detection state
from a previous note or from a pre-listening meeting signal.

Desktop meeting detection owns its signal inputs in Electron. Calendar
candidate selection, native microphone activity clients, source normalization,
debounce, dismissal, suppression, and widget window visibility stay in
`apps/desktop`; the renderer receives an aggregate meeting-detection state and
may render it or send user actions back through `packages/platform`. Renderer
code must not inspect running applications, microphone activity, calendar state,
or desktop windows directly to decide whether a meeting exists.

Proxy response handling must match the body strategy. Streamed routes may pipe
the upstream body with upstream headers. Buffered or decoded proxy responses
must emit fresh body headers and must not forward stale `content-encoding`,
`content-length`, or `transfer-encoding`.

## Desktop Runtime

Desktop tray state belongs to Electron, but it must mirror the renderer's active
account, workspace, calendar connection state, and calendar display preferences.
Renderer changes to calendar state should notify Electron to refresh the tray.

Desktop app lifecycle sequencing is owned by
`apps/desktop/src/desktop-boot-orchestrator.mjs`. The Electron main module may
compose concrete adapters, but lifecycle ordering for single-instance handling,
ready startup, suspend handling, window-all-closed cleanup, and before-quit
cleanup must stay behind the boot orchestrator interface.

Electron Builder packages dependencies from `apps/desktop/package.json`. Any
package imported by packaged desktop runtime code through `apps/desktop`,
`packages/ai`, or copied runtime modules must be declared there.

The desktop build packages generated runtime artifacts only. Packaged Electron
main code lives in `dist-electron/main/index.js`, and packaged renderer assets
live in `dist-app`. Packaged windows load renderer assets through `app://ui`.
Packaged runtime code must not rely on source-tree imports or a packaged
`node_modules` tree.

The generated package shape is owned by
`apps/desktop/scripts/desktop-package-contract.mjs`. Build scripts, Electron
Builder config, and package verification must read package paths and ASAR
rules from that module instead of repeating release layout strings.

Renderer route ownership lives in `packages/platform/src/renderer-routes.mjs`.
The packaged desktop protocol must use that manifest to decide whether an
`app://ui` pathname is a renderer route. Desktop protocol code must not carry a
private duplicate list of renderer route prefixes.

The desktop local server keeps Node HTTP transport and route dispatch in
`apps/desktop/src/local-server.mjs`. Reusable HTTP/CORS behavior, hosted AI
proxying, note AI routes, realtime transcription session creation, and local
folder tool execution live behind dedicated local-server modules. Chat
streaming transport may remain in the local server module, while shared hosted
chat helpers own prompt construction, run-plan assembly, tool-loop setup, save
payloads, and active-stream persistence.

Desktop packages must keep the app runtime in `Contents/Resources/app.asar`.
Only native helpers and bundled media tools may be unpacked into
`Contents/Resources/app.asar.unpacked` through targeted `asarUnpack` rules.
Runtime helper resolution must prefer the unpacked mirror before development
helper paths. Electron currently emits a terminal-only Node `DEP0180` warning
from its internal ASAR filesystem adapter (`electron/electron#47390`); do not
disable ASAR or add app-level suppression for that upstream warning.

Desktop auth cookies persist in an explicit JSON store under Electron's
`userData` directory with owner-only file permissions. Packaged OSS builds must
not use Electron Safe Storage, macOS Keychain, or another OS credential prompt
for routine session-cookie persistence. Renderer windows must not use Electron's
default persistent Chromium profile as an auth store; desktop auth state belongs
to the IPC auth bridge and desktop auth cookie store. Desktop startup must pass
Chromium's mock-keychain switch before renderer windows are created so Chromium
storage never opens the macOS Keychain prompt.

## Required Verification

After building the desktop package, run:

```sh
bun --filter=desktop run verify:package
```

The verifier must fail if:

- The packaged `Contents/Resources/app` runtime contains a stale development
  Convex deployment.
- The packaged `Contents/Resources/app` runtime misses the expected hosted
  Convex deployment.
- The bundled renderer contains stale dev Vite constants.
- Packaged runtime code imports Convex server TypeScript.
- Bare package imports in `dist-electron` cannot resolve from packaged
  `node_modules`.

## Enforcement

`bun run check`, `bun run typecheck`, targeted tests, and
`bun --filter=desktop run verify:package` enforce this document's invariants.
Desktop realtime transcription changes must include the desktop transport tests
for stop-flush behavior and renderer auto-stop tests for meeting/idle state.

Repeated architecture failures should become scripts, lint rules,
package-boundary checks, or tests instead of more prose.
