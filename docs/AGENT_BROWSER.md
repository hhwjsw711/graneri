# Agent Browser Workflow

Graneri is an Electron desktop app with a shared web renderer. Use
`agent-browser` for app validation when the task requires interacting with the
running product. Do not use Chrome DevTools MCP as a substitute for desktop app
QA unless the user explicitly asks for it.

## When To Use It

Use `agent-browser` for:

- driving `Graneri.app` through the real Electron surface;
- checking desktop-only behavior such as native recording, widgets, app source
  detection, local files, IPC, preload, and packaged runtime behavior;
- validating browser-supported renderer behavior when the user asks for web QA;
- inspecting UI state after a rebuild.

Use normal shell checks for static validation:

```bash
bun run check
bun run typecheck
npx -y react-doctor@latest . --verbose --diff
```

## Build First

For renderer or desktop code changes, rebuild before testing the packaged app:

```bash
bun --filter=desktop run build
```

If the test needs a fresh distributable installer, use the release build flow
from `AGENTS.md` instead of this quick build.

## Launch Graneri With CDP

Quit the currently running Graneri instance before launching with remote
debugging. The `--remote-debugging-port` flag only works when present at app
startup.

```bash
apps/desktop/release/mac-arm64/Graneri.app/Contents/MacOS/Graneri --remote-debugging-port=9222
```

For development renderer testing against the local web server, start the web
renderer separately and launch Electron with the renderer URL:

```bash
bun run dev:web
```

```bash
GRANERI_RENDERER_URL=http://127.0.0.1:3000 GRANERI_DISABLE_UPDATER=1 ./node_modules/.bin/electron . --remote-debugging-port=9222
```

Use port `9222` by default. If it is busy, choose another port and use the same
port for every `agent-browser` command in that session.

## Connect

Connect `agent-browser` to the running Electron app:

```bash
agent-browser connect 9222
agent-browser tab
agent-browser snapshot -i
```

If there are multiple targets, switch to the Graneri app target before taking a
snapshot:

```bash
agent-browser tab
agent-browser tab 0
agent-browser snapshot -i
```

Keep the app in dark mode when inspecting UI:

```bash
AGENT_BROWSER_COLOR_SCHEME=dark agent-browser connect 9222
```

## Interaction Loop

Use the snapshot loop:

```bash
agent-browser snapshot -i
agent-browser click @e3
agent-browser snapshot -i
```

Element refs are fresh per snapshot. Re-snapshot after every click, navigation,
dialog open, route change, list update, or stream update before using another
`@eN` ref.

Prefer semantic commands when a ref is not stable:

```bash
agent-browser find role button click --name "Quick note"
agent-browser find text "Automations" click
agent-browser find placeholder "Ask anything" fill "test prompt"
```

## Screenshots

Use screenshots for visual checks and user-facing status:

```bash
agent-browser screenshot /tmp/graneri-state.png
agent-browser screenshot --annotate /tmp/graneri-annotated.png
```

Annotated screenshots are useful when refs are ambiguous.

## Logs And Runtime Signals

Use terminal logs from the launched app process for main-process and preload
diagnostics. Use `agent-browser` for renderer-visible behavior and page state.

Useful `agent-browser` probes:

```bash
agent-browser get url
agent-browser get title
agent-browser snapshot -i --json
agent-browser network requests
```

When diagnosing a native desktop flow, capture the timeline in this order:

1. Launch Graneri with `--remote-debugging-port=9222`.
2. Connect with `agent-browser connect 9222`.
3. Take a baseline `snapshot -i`.
4. Perform exactly one user action.
5. Re-snapshot.
6. Read terminal logs for the same window of time.

Do not infer native recording state from the UI alone. Confirm it from the UI
and the relevant logs.

## Common Graneri Checks

### Sidebar Counters

```bash
agent-browser find text "Automations" click
agent-browser snapshot -i
agent-browser find text "Inbox" click
agent-browser snapshot -i
```

Check that badges are neutral and visible in both rows.

### Note Chat Edit

```bash
agent-browser find text "Ask AI" click
agent-browser snapshot -i
```

Open a note chat, click the edit action, and verify the edited message hydrates
the composer input before submitting.

### Inbox Sheet Scroll

```bash
agent-browser find text "Inbox" click
agent-browser snapshot -i
agent-browser scroll down 600
agent-browser snapshot -i
```

The inbox panel should scroll independently of the note body and preserve resize
behavior.

### Desktop Recording

Use the packaged app, not browser-only web. Start from a clean app launch with
CDP enabled. Check widget visibility, source name, note reuse, recording state,
and logs after each action.

## Troubleshooting

If `agent-browser` cannot connect:

```bash
agent-browser doctor --offline --quick
lsof -i :9222
```

If the app was already running without the CDP flag, quit it and relaunch with
`--remote-debugging-port=9222`.

If an element ref fails, the page changed. Run:

```bash
agent-browser snapshot -i
```

If typing into a custom input does not work:

```bash
agent-browser focus @e1
agent-browser keyboard inserttext "text"
```

If the wrong target is selected:

```bash
agent-browser tab
agent-browser tab <target-id>
agent-browser snapshot -i
```

## Rules For Future Agents

- Prefer `agent-browser` for Graneri desktop app QA.
- Rebuild before validating packaged app changes.
- Launch Electron with CDP before connecting.
- Re-snapshot after every state-changing action.
- Keep refs local to the snapshot that produced them.
- Use terminal logs plus UI checks for native recording flows.
- Do not switch to Chrome DevTools MCP for desktop app validation unless the
  user asks for it.
