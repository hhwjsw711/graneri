# Repository Guidelines

## Project Structure & Module Organization
`graneri` is a Bun workspace managed with Turbo. Graneri is desktop-first and
web-supported; `docs/ARCHITECTURE.md` is the system of record for runtime
boundaries, desktop release invariants, Convex integration, and shared AI tool
contracts. Read it before changing those areas, and update it in the same change
when a boundary or release rule moves.

Primary code locations:

- `apps/desktop`: Electron main/preload, native permissions, capture services,
  local server, packaging, updater behavior, and desktop release concerns.
- `apps/web`: Vite + React renderer used by the desktop app plus the browser
  entrypoint.
- `apps/marketing`: Vite + React marketing site.
- `packages/ai/src`: shared AI runtime modules, hosted chat orchestration,
  tool contracts, transcription helpers, and connected-app capability metadata.
  Keep Convex server implementation details behind adapters or Convex
  boundaries.
- `packages/platform`: shared desktop bridge types and renderer-safe platform
  helpers. Renderer code should use this package instead of reading
  `window.graneriDesktop` directly.
- `packages/ui/src`: shared UI primitives.
- `convex/`: backend logic and schema. Read
  `convex/_generated/ai/guidelines.md` before changing Convex functions,
  schema, auth, or HTTP routes.
- `apps/web/tests`: current Vitest and Testing Library tests.

Treat desktop capabilities as first-class platform APIs exposed through narrow
preload/IPC contracts, not incidental browser fallbacks.

## Core Priorities
1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability
Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Build, Test, and Development Commands
Run `bun install` once at the repo root. Use `bun dev` to start the local stack, `bun run dev:web` for the web app only on port `3000`, `bun run dev:marketing` for the marketing site on port `3001`, and `bun run dev:desktop:native` when you need the packaged macOS desktop app for native permission or system-audio testing. Use `bun run build` for all workspace builds, `bun run test` (runs Vitest plus Convex tests) for all tests, `bun run typecheck` for TypeScript checks, and `bun run check` for non-mutating Biome validation. Use `bun run check:fix` or `bun run lint:fix` when you intentionally want Biome to rewrite files. Package-scoped commands mirror the root flow, for example `cd apps/web && bun run test`.

For official desktop release checks, run `bun run dist:mac` with the hosted `GRANERI_HOSTED_*` values, then run `bun --filter=desktop run verify:package`. The verifier checks the packaged app for stale dev Convex deployments, missing runtime dependencies, forbidden Convex server TypeScript imports, required native runtime helpers, and the combined audio helper AEC3 self-test.

## Coding Style & Naming Conventions
Biome is the formatter and linter (`biome.json`). Use tabs for indentation, double quotes for JavaScript/TypeScript, and let Biome organize imports. `lint` and `check` should be treated as validation commands; `format`, `lint:fix`, and `check:fix` are the mutating commands. React components use PascalCase file names such as `ChatPage`; hooks stay in camel case like `use-mobile.ts`; Convex modules use descriptive lower camel or kebab-free file names such as `notes.ts`. Prefer small shared UI additions in `packages/ui` rather than duplicating components in apps.

## Code Quality
Avoid `any` types unless they are absolutely necessary and locally justified. Before guessing external API shapes, check the dependency's installed type definitions under `node_modules` and use the exported types. Never use inline imports: do not write `await import("./foo.js")` for runtime code or `import("pkg").Type` in type positions. Use standard top-level imports for runtime values and `import type` declarations for types.

## Testing Guidelines
Web tests use Vitest with Testing Library and `jsdom`. Name tests `*.test.tsx` and keep them near feature-level behavior, as in `apps/web/tests/chat-page.test.tsx`. Run `bun run test` before opening a PR; for frontend changes, also run `bun run typecheck` and `bun run check`. Desktop changes should pass `bun --filter=desktop run typecheck` and `bun --filter=desktop run check`; native behavior should include targeted tests when practical or a clear manual verification note when it depends on macOS permissions, packaging, or system audio. Desktop realtime transcription changes must cover stop-flush behavior, combined-helper AEC3 behavior, and renderer auto-stop behavior where applicable.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits: `feat: ...`, `fix: ...`, `docs: ...`. Keep commit subjects imperative and scoped to one change. PRs should include a short summary, linked issue if applicable, verification steps, and screenshots or recordings for visible UI changes. Call out any Convex schema or auth changes explicitly so reviewers can check deployment and environment impact.

## Security & Configuration Tips
Keep secrets in `.env.local`; do not commit local env files. Review `.env.example` when adding config. For Convex auth, derive identity server-side and avoid passing user identifiers as trusted client arguments.
