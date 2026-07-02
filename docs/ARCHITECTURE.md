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
prompt construction, active-turn input preparation, branch preparation,
tool-loop setup, message persistence payloads, and active-stream persistence
behavior; callers provide runtime-specific reads, writes, request transport,
and desktop-local capabilities through small adapter callbacks.
Turn input buffering is separate from active-stream transport: the hosted turn
input buffer owns pending steer/mailbox ordering, wait-agent activity
notifications, and mailbox deferral rules, while active-stream sessions own
broadcast, replay, abort, and persistence.
Hosted and desktop chat routes share the same user-message persistence helper
for normal saves, queued replay accepts, queued steer batch accepts, and
continued-run message appends; route handlers keep runtime-specific telemetry,
HTTP response formatting, and local capability adapters.
The hosted web chat route delegates active-run policy, same-run validation,
queued acceptance headers, assistant-run start, stream finalization, initial
AI SDK stream piping, and reconnect stream piping to its hosted stream runtime
module so HTTP parsing/context assembly stays separate from turn execution.
Assistant run start and active-stream session start share one runtime helper so
both web and desktop choose the same reject/supersede policy, reuse matching
continued runs, terminalize failed starts, and clean up partially-created stream
sessions.
Hosted chat runs are durable Convex lifecycle records. `assistantRuns` owns run
state, stop/failure/completion history, and the one-active-run-per-chat
invariant. `chatActiveStreams` and active `chatToolCalls` are temporary render
snapshots scoped to a run; terminal runs must leave no stream or active tool
snapshots behind. These records do not move desktop-local tool execution out of
the renderer/local-server bridge.
`assistantRunEvents` is the durable ordered timeline for a run. It records typed
events such as run start/stop/fail/complete, tool lifecycle changes, completed
assistant messages, and human-input requests. Events are append-only per run and
queried by `runId` plus `eventIndex`. Tool lifecycle events must be
self-contained for replay/debugging: started events carry the serialized tool
input when available, and completed events carry serialized output or error
details when available. High-frequency streamed text belongs in the active
stream snapshot during the run and in the saved assistant message after
completion; it should not be duplicated as per-token event rows.
Active stream snapshot writes are fail-closed runtime state. Appending text or
tool lifecycle updates to a missing snapshot, wrong run, or non-running run is a
producer/state divergence and must surface as a stream failure that terminalizes
the run; it must not silently drop output.
The client stream must not close as successful until completed-run finalization
has saved the assistant message, closed temporary stream/tool snapshots, and
terminalized the `assistantRuns` record. Finalization failures are request
failures, not background cleanup. A failed finalization attempt must leave the
same terminalization pending so a later flush can retry; it must not poison the
finalization queue with a permanently rejected in-flight promise.
Reconnect recovery follows the same no-leftover rule: when a reconnect finds a
non-terminal run without a live in-process stream producer, the route must mark
the run stopping, attempt to save/delete the active stream snapshot, and
terminalize the run in a `finally` path. Snapshot cleanup failures may still
surface to the caller, but they must not leave the run blocking future queue
drain or chat sends. Manual stop uses the same shape: record durable stop
intent before stream cleanup, and terminalize in `finally` after cleanup is
attempted.
Snapshots remain the live render surface; historical inspection, future missed
event replay, and debugging should use run events plus saved messages rather
than preserved snapshot rows.
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
non-terminal run; clients must queue follow-ups against the active run.
`startAssistantRun` only supports reject or explicit supersede policies;
it must never return an existing active run as a fallback. Assistant runs are
created directly as `running`; queued work is represented by
`assistantQueuedMessages`, not by a queued assistant-run status. Queries that
attach to or report the active run must fail closed if more than one
non-terminal run exists for a chat, because choosing a winner would hide a
broken single-flight invariant. Regenerate is the explicit supersede path. Stop requests are
idempotent at the HTTP boundary: no attachable run means there is nothing left
to stop, so the route may return success without creating synthetic run state.
Follow-up queueing is durable run state, not UI-local buffering.
`assistantQueuedMessages` stores queued user messages and durable request
context scoped to the active run. It must not persist desktop-local folder
selections; follow-ups that need local folders must wait for the active answer
instead of entering the durable queue. Completed runs leave queued follow-ups
for the client drain path, which claims the next queued item only after no
non-terminal run remains for the chat. User input uses upstream app-server input
gates: HTTP chat routes, client queue serialization, `saveMessage`, and
queued-message mutations reject empty user text and more than 1,048,576 text
characters before the input can enter the AI SDK loop or durable queue state.
Claimed replay is still server-owned: the client
rebuilds request state through the queued-intent module with a fresh Convex
token and sends `replayQueuedMessageId`; `/api/chat` must load the claimed
durable queue row and reconstruct the user message from that row before branch,
tool-policy, or persistence preparation. It must then atomically save the user
message and delete the claimed queue row through `acceptQueuedUserMessage`
before starting the assistant run. A client may call `discardClaimed` only when
submission fails before the server accepts the replay; successful replay must
not depend on a second client cleanup mutation. Post-accept replay setup
failures must carry `X-Graneri-Replay-Accepted: true` and
`X-Graneri-Replay-Queued-Message-Id` so the transport can resolve the already
accepted input as an empty successful stream instead of rolling it back. Manual
steer must be prepared as a queued steer intent and sent through
`/api/chat/steer` with both `steerQueuedMessageId` and the expected active
`continueRunId`; ordinary `/api/chat` requests must reject steer payloads
instead of falling back to implicit behavior. Hosted web and desktop direct
routes must return the same structured `{ error, errorCode }` JSON body for
queued replay and steer validation failures, and must reject malformed IDs
before Convex state lookup or mutation. Steer input is queue-id driven: the
server reconstructs the user message from the claimed durable queue row and must
not require or trust a client-supplied `message` body. The hosted chat turn
controller claims the queued message through adapter callbacks, interrupts an
actively running stream and saves partial assistant output, or resumes the same
run directly when the run is `waiting_for_user`. The route then atomically
accepts the claimed queue row by saving the user message, recording
`turn.steer.accepted` plus `user.message.appended` on the same `assistantRuns`
timeline, clearing any pending decision, deleting the claimed queue row, and
starting the next assistant stream without terminalizing the run. Both replay
and steer accept mutations validate the saved user message id, text, and model
text parts against the claimed durable queue row; callers must not trust
client-supplied message bodies over durable queue state. The streaming response
carries `X-Graneri-Steer-Accepted: true`, `X-Graneri-Turn-Id`,
`X-Graneri-Queued-Message-Id`, and `X-Graneri-Queued-Message-Ids` headers after
the atomic accept succeeds so clients can distinguish accepted steering from
ordinary sends without changing the AI SDK stream body; the singular queued id
identifies the targeted steer row and the plural header lists the full accepted
batch. Post-accept setup failures must preserve these headers because the steer
was already accepted by the active turn. The web transport
must treat non-2xx steer responses with these headers as accepted empty streams
instead of rolling back the queued UI item; pre-accept failures without the
headers still surface as normal send failures. Stop, supersede, and
completed-run cleanup remove claimed queue rows for terminalized run state.
Any chat-level cleanup path that stops an active run, including branch
truncation and chat removal, must also append the stopped run event, delete live
snapshots, and discard both queued and claimed follow-ups for the stopped run.
Client cleanup mutations for individual queued or claimed rows must be scoped
by workspace and chat and must fail closed when the row belongs to another chat
or is in the wrong queue state; wrong-scope cleanup must preserve the row rather
than hide a stale client or cross-session bug.
Chat deletion and branch truncation must fail closed on invalid persisted
attachment metadata or storage ids; cleanup must not silently skip malformed
stored attachment references and continue deleting surrounding chat state.
Otherwise stale claimed rows are requeued by Convex claim mutations before the
next claim attempt, because `claimed` represents an unaccepted in-flight
operation and must not become an invisible durable leftover after a client or
transport crash. Durable queued request state must not persist desktop-local
folder scope or absolute paths; follow-ups that need local-folder tools must
wait for the current run to finish.

### Queue Behavior

The upstream app-server is the reference for active-turn user input semantics. Graneri keeps the
same separation of responsibilities with its stack: AI SDK routes own the
stream/tool loop and acceptance headers, while Convex owns durable coordination,
atomic queue claims, lifecycle invariants, and replayable state. The target is
matching behavior, not identical storage.

| Reference behavior | Graneri implementation | Status |
| --- | --- | --- |
| One active turn owns in-flight user input. | `assistantRuns` enforces one non-terminal run per chat; duplicate active-run queries and queue claims fail closed with `ASSISTANT_RUN_INVARIANT_VIOLATION`. | Implemented |
| User input can be accepted during an active turn without trusting the client copy. | `/api/chat/steer` claims `assistantQueuedMessages` by id and reconstructs the user message from Convex before acceptance. | Implemented |
| Replay after a completed turn uses server-owned queued input. | `/api/chat` accepts only `replayQueuedMessageId`, loads the claimed row, saves the user message, and deletes the claim before starting a new run. | Implemented |
| Accepted input remains accepted even if later stream setup fails. | Replay and steer routes emit accepted headers and the web transport resolves post-accept failures as empty successful streams. | Implemented |
| Stale or wrong targeted input does not silently disappear. | Targeted queue claims throw Convex errors for missing rows, wrong run, inactive turns, existing claims, wrong chat, or wrong queue state. | Implemented |
| No queued assistant-run fallback exists. | Runs start directly as `running`; durable follow-ups live only in `assistantQueuedMessages`. | Implemented |
| Stale claimed input is not an invisible leftover. | Claim mutations requeue stale claimed rows before attempting the next claim; terminal run cleanup deletes queued and claimed rows for that run. | Implemented |
| Waiting-for-user input resumes the same turn. | `waiting_for_user` runs can claim and accept steered input, clear `pendingDecision`, append `turn.steer.accepted`, and continue without creating a second run. | Implemented |
| Pending input is local to a turn and can be drained into the next turn state. | Hosted active stream sessions expose `extendPendingInput`, `takePendingInput`, `hasPendingInput`, and `clearPendingInput`; running steer interruptions append the steered message, drain the active session, and feed ordered pending user messages into the next AI SDK prompt branch with message-id de-duplication against persisted history. | Implemented |
| Multiple active-turn inputs can accumulate before the model loop drains them. | Graneri can persist multiple queued follow-ups, the renderer accepts distinct manual steer intents into a FIFO while one steer request is in flight, `claimReadyForRun` claims the targeted row plus ready queued rows for the same active run, `acceptSteeredUserMessages` atomically saves/deletes the accepted batch, and active stream replacement carries ordered pending input until it is drained into the next prompt branch. | Implemented |
| Activity subscribers can distinguish mailbox work from steered input. | Hosted active stream sessions expose `subscribePendingInputActivity`; pending steered input reports `steer`, queued mailbox-style input reports `mailbox`, and subscribing after input is already pending returns the pending activity. | Implemented |
| A model tool can wait for mailbox or steer activity. | Graneri exposes a runtime-only AI SDK `wait_agent` tool. It subscribes to hosted active stream activity, wakes immediately on already-pending activity, returns app-server-compatible `{ message, timed_out }` results for mailbox, steer, and timeout, and aborts with the active turn. | Implemented |
| Mailbox delivery is accepted into turn state. | Hosted active stream sessions keep mailbox-style pending input separate from steered input, can defer mailbox delivery after an answer boundary, and reopen delivery when steered input arrives. Replacement sessions carry both steer and mailbox pending input forward. | Implemented |
| A model can create and manage live subagents. | Graneri does not expose subagent tools because the product does not have subagents. Runtime tools such as `spawn_agent`, `send_message`, `followup_task`, `list_agents`, and `interrupt_agent` are intentionally out of scope. | Not applicable |

The current queue, steering, replay, and run-lifecycle slice is close to the reference
for durable correctness and fail-closed behavior. Graneri keeps mailbox activity
and wait primitives for active-turn user input, but it does not implement
reference subagents. Graneri drains accepted input at the AI SDK stream restart
boundary into the next prompt branch, while Convex remains the durable source of
truth for user input, chat runs, crash recovery, and cross-process coordination.

Connected app AI capabilities are declared in
`packages/ai/src/capability-registry.mjs`. The registry is the source of truth
for provider identity, source instructions, tool-discovery prefixes, and tool
builders. Desktop-local capabilities such as shared local folders and native
transcription remain desktop bridge APIs, not generic connected-app
capabilities.

`convex/`
: Server functions, schema, HTTP actions, auth, and server-only integrations.
Read `convex/_generated/ai/guidelines.md` before changing Convex code. Convex
derives ownership from server-side identity; client arguments may select
resources such as workspace or chat ids, but they must not be trusted as owner
identity. Hosted auth provider configuration is fail-closed: missing OAuth
provider credentials must reject configuration instead of substituting
placeholder client ids or secrets.

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
Production desktop packages default to the `com.graneri.desktop` bundle
identifier. Local/dev packages keep `dev.graneri.desktop` so installed
production builds and repo-built verification bundles do not share macOS app
identity.

## Desktop AI

The desktop local server owns desktop AI HTTP routes. Renderer fetches and
native desktop capture both cross this boundary before any OpenAI request:

- `/api/chat`
- `/api/chat/steer`
- `/api/chat/stop`
- `/api/chat/:chatId/stream`
- `/api/apply-template`
- `/api/enhance-note`
- `/api/realtime-transcription-session`

Packaged desktop apps must not embed `OPENAI_API_KEY`. Local development uses
the same desktop local server route boundary, with `.env.local` supplying
server-side secrets. If hosted site config is present and no process-local
OpenAI key exists, the desktop local server proxies AI routes to
`GRANERI_HOSTED_SITE_URL`/`SITE_URL`. Convex HTTP is not an AI SDK streaming
fallback; it remains the durable backend, auth/OAuth callback surface, and
state coordination layer. Release behavior must not depend on
terminal-inherited shell environment.
Hosted production deployments must expose the same AI HTTP routes as real
serverless functions under `/api/*`; Vite dev/preview middleware is only the
local development surface and is not a Vercel production route by itself.

Local-folder chat uses a hosted-model, desktop-tool bridge:

1. The hosted web AI route owns the OpenAI key and model loop.
2. The hosted web AI route declares local folder tools without server-side executors.
3. The desktop renderer receives client-side local tool calls.
4. The renderer executes those calls through the desktop local server against
   folders explicitly shared through the desktop bridge.
5. The renderer attaches tool output and lets the AI SDK resubmit the
   conversation to hosted Convex.

Client-side local tool outputs must resubmit with the same chat request body,
including `localFolders`, so subsequent hosted model steps keep the same desktop
tool context. Durable queued replay and steer are the exception: queued request
state is stored in Convex and must reject non-empty `localFolders` rather than
persisting local filesystem selections.

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
the native transport must explicitly commit non-empty OpenAI input audio
buffers during live capture. Empty-buffer commits are not a valid path; they
create recoverable-looking OpenAI errors that can collapse into start/stop
loops.

Desktop meeting audio must preserve two distinct sources: microphone audio is
the `you` source, and native system audio is the `them` source. Built-in speaker
routes may need echo/leakage suppression so remote speech does not bleed into
the microphone stream and get labeled as `you`, but that suppression must not
duck or lower the user's meeting audio. Headphone routes should not enable
microphone voice-processing or echo-cancellation paths because there is no
speaker playback to suppress. The target architecture is a combined native
capture pipeline: capture microphone and system audio with synchronized timing,
use system audio as the echo-cancellation render/reference for the microphone
stream, emit cleaned microphone audio as `you`, and emit raw system audio as
`them`. Apple voice processing is a route-scoped stopgap, not the long-term
source-separation mechanism.
The combined helper must disable Apple microphone voice processing and own echo
reduction itself, because Apple processing can alter the user's local meeting
volume and obscure which source caused attenuation.

Native audio helpers communicate with Electron over newline-delimited JSON.
`ready`, `chunk`, `error`, and `stopped` are the only helper event families.
Separate microphone and system-audio helpers infer source from the process that
emitted the event. A combined helper must emit the same `chunk` shape plus a
`source` field set to `microphone` or `systemAudio`, allowing Electron to keep
the speaker contract stable while the native process owns synchronized capture
and echo-cancellation reference timing. The combined helper binary is the
native integration point for echo reduction. Its microphone path must flow
through the combined audio processing pipeline, and that pipeline must use
system audio as the render/reference signal before microphone audio is emitted.
Echo reduction must be correlation-gated: active system audio alone is not a
reason to subtract from the microphone stream, because local-only speech during
remote playback must pass through unchanged. After AEC3 runs, the microphone
path applies one source-attribution gate: if system audio is active and the
post-AEC microphone energy is below the local-speech floor, that residual is
silenced before it can be emitted as `you`. Double-talk above that floor must
remain in the microphone stream.
The combined helper's ready event must report the audio processing stage so
diagnostics can tell whether microphone output is waiting for render reference
or actively reducing echo.
`bun --filter=desktop run diagnose:meeting-audio -- --play-system-sound` is the
local smoke test for this boundary. It starts the combined helper, plays a short
system sound, and reports only route metadata, source chunk counts, and bounded
processing diagnostics. It must not print or persist raw PCM.

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

Desktop tray state belongs to Electron. It may mirror renderer-owned account,
workspace, and preference state for actions such as notification policy and note
creation, but tray event discovery itself is a desktop-native responsibility.
Renderer changes that affect desktop-owned tray behavior should notify Electron
to refresh the tray.
Tray calendar events come from the authenticated renderer's connected-calendar
query result and are pushed into Electron through the desktop bridge. Electron
must own tray state, menu rendering, notifications, and meeting-signal
selection from that synced data. The tray must not fetch Convex directly or
depend on a separate desktop auth-token refresh path to show upcoming meetings.

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
HTTP response formatting and desktop-local logging may remain in the local
server module, while shared hosted chat helpers own prompt construction,
run-plan assembly, tool-loop setup, branch preparation, save payloads,
active-stream persistence, and stream finalization mechanics.

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
- Required native runtime helpers are missing, or the combined audio helper
  fails its AEC3 self-test, including residual-leak gating for active system
  audio.

## Enforcement

`bun run check`, `bun run typecheck`, targeted tests, and
`bun --filter=desktop run verify:package` enforce this document's invariants.
Desktop realtime transcription changes must include the desktop transport tests
for stop-flush behavior, native audio tests for combined-helper AEC3 behavior,
and renderer auto-stop tests for meeting/idle state.

Repeated architecture failures should become scripts, lint rules,
package-boundary checks, or tests instead of more prose.
