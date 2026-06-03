# Contributing

## Read this first

Graneri is early.

We are not actively accepting broad contributions yet. You can still open an issue or PR, but expect us to close it, defer it, or ask you to make it much smaller.

That is not personal. We are keeping scope, quality, desktop behavior, and self-hosting boundaries under control while the project is still taking shape.

## What we are most likely to accept

Small, focused bug fixes.

Reliability fixes.

Performance improvements.

Security fixes.

Documentation fixes that make self-hosting or local development clearer.

## What we are least likely to accept

Large PRs.

Drive-by features.

Opinionated rewrites.

Product scope changes that were not discussed first.

Anything that weakens desktop permissions, Convex authorization, auth callbacks, release configuration, or self-hosting defaults.

## Before opening a PR

Keep it small.

Explain exactly what changed.

Explain why the change should exist.

Do not mix unrelated fixes together.

For UI changes, include before/after screenshots. For motion, timing, permissions, packaging, updater behavior, or native desktop behavior, include a short manual verification note.

## Local development

```bash
bun install
bun run doctor:self-host
bun dev
```

Use `.env.local` for local secrets. Do not commit `.env`, `.env.local`, API keys, OAuth secrets, production deployment URLs, or generated private credentials.

## Checks

Run the relevant checks before opening a PR:

```bash
bun run check
bun run typecheck
bun run test
```

For desktop changes, also run:

```bash
bun --filter=desktop run check
bun --filter=desktop run typecheck
```

## Issues first

If you are thinking about a non-trivial change, open an issue first.

That does not mean we will accept the PR, but it gives you a chance to avoid wasting time.

## License

By contributing, you agree that your contributions are licensed under the repository license.
