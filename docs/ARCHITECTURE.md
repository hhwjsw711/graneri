# Architecture

Graneri is desktop-first and web-supported. The desktop product is an Electron
shell in `apps/desktop` that packages the Vite renderer from `apps/web` and
talks to Convex for backend state and AI actions.

This is a living document. Update it in the same change whenever a runtime
boundary, packaging rule, release configuration path, or Convex integration
contract changes. Do not treat it as historical documentation; it should describe
the current system well enough for agents and maintainers to make safe changes.

## Runtime Boundaries

`apps/desktop` owns Electron main, preload, IPC, native permissions, capture
helpers, packaging, updater behavior, and desktop release configuration.

`apps/web` owns the React renderer used by both the browser app and the desktop
app. Desktop builds still compile this renderer with Vite, so release-time
environment values must be correct in both Electron and Vite.

`packages/platform` is the only renderer-safe package that may read
`window.graneriDesktop`. Other renderer code must go through this package.

`packages/ai` is shared runtime code. It must not import Convex server modules
or any `convex/*.ts` file. Server-only behavior must be passed in through
adapters, or invoked through a Convex client/action boundary.

`convex/` owns server functions, schema, HTTP actions, auth, and server-only
integrations. Read `convex/_generated/ai/guidelines.md` before changing Convex
code.

## Desktop Release Configuration

Official packaged desktop builds must embed public hosted URLs in two places:

- Electron main/runtime config, generated into
  `apps/desktop/dist/hosted-runtime-config.mjs`
- Vite renderer constants, generated into `apps/web/dist`

The hosted URLs are public configuration, not secrets. They identify the hosted
Convex and web deployments. Secrets such as `OPENAI_API_KEY`,
`BETTER_AUTH_SECRET`, OAuth client secrets, deploy keys, and signing credentials
must never be embedded into desktop builds.

For official builds, pass:

```sh
GRANERI_HOSTED_CONVEX_URL=https://<prod-deployment>.convex.cloud
GRANERI_HOSTED_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
GRANERI_HOSTED_SITE_URL=https://<hosted-app-origin>
```

Self-hosted builds may pass their own hosted URLs or rely on local runtime env.

Local development builds must stay local. `bun dev` and desktop dev runs should
load `.env.local`/local runtime values and connect to the development Convex
deployment. Production Convex and hosted app URLs belong only in official
packaged builds or hosted web deployments.

Desktop tray data is part of the desktop runtime, but it must mirror the
renderer's active account, workspace, calendar connection state, and calendar
display preferences. When the renderer connects or toggles a calendar provider,
it should notify Electron to refresh the tray instead of waiting for an
unrelated notification or restart.

## Desktop AI Request Routing

The desktop local server owns renderer-facing AI HTTP routes such as
`/api/chat`, `/api/apply-template`, `/api/enhance-note`, and
`/api/realtime-transcription-session`. Packaged desktop apps must not embed
`OPENAI_API_KEY`. When a packaged app has hosted Convex/site config but no local
OpenAI key, the local server proxies these AI routes to the hosted Convex site
URL. When a local OpenAI key is available, the same handlers may execute locally
instead. This means terminal-launched packaged apps can differ from Finder
launches because terminal processes inherit shell environment variables.

Keep proxy response handling matched to the body strategy. Streamed routes may
pipe the upstream body and forward upstream headers together. If a proxy handler
buffers or decodes an upstream body before sending it to the renderer, it must
not forward stale body-specific headers such as `content-encoding`,
`content-length`, or `transfer-encoding`; send fresh response headers that match
the emitted body. Otherwise browsers can attempt to decode already-decoded JSON
and surface misleading empty-payload failures.

## Packaging Rules

Electron Builder packages dependencies from `apps/desktop/package.json`. If a
desktop runtime path imports a package through `apps/desktop`, `packages/ai`, or
other copied runtime code, that package must be declared in
`apps/desktop/package.json`.

The desktop build copies runtime source into `.bundle-root` before packaging.
Do not rely on source-tree imports that point outside `.bundle-root` at runtime.
Packaged app verification must inspect `app.asar`, not only source files.

Before shipping a desktop build, verify:

- `app.asar` contains the expected hosted Convex deployment.
- `app.asar` does not contain a dev Convex deployment.
- The bundled renderer does not contain stale dev Vite constants.
- Packaged runtime code does not import Convex server `.ts` files.
- Bare package imports in `.bundle-root` resolve from packaged `node_modules`.

Run:

```sh
bun --filter=desktop run verify:package
```

after building the desktop package.

## Known Failure Pattern

A release can appear correct in Electron main but still connect to the wrong
backend if the packaged Vite renderer was built with stale `VITE_CONVEX_URL` or
`VITE_CONVEX_SITE_URL`. Always treat desktop runtime configuration as a two-layer
problem: Electron main plus web renderer.
