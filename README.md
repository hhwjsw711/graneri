<a href="#graneri">
  <img alt="Open-source Granola-like notepad built with Vite, Electron, AI SDK, and Convex." src="./apps/web/public/preview/graneri.png">
  <h1 align="center">Graneri</h1>
</a>

<p align="center">
  Open-source Granola-like notepad built with Vite, Electron, AI SDK, and Convex.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#apps"><strong>Apps</strong></a> ·
  <a href="#self-hosting"><strong>Self-hosting</strong></a> ·
  <a href="#desktop-builds"><strong>Desktop builds</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- Live meeting transcription with notes generated as conversations happen
- AI-powered note refinement for cleaner summaries and better structure
- Custom note templates for repeatable meeting formats and workflows
- Workspace organization for keeping teams, notes, and context aligned
- Desktop meeting workflow with quick capture during active calls
- Calendar-aware setup that prepares notes around scheduled meetings

## Apps

- `apps/web`: browser app and shared renderer
- `apps/desktop`: Electron desktop app for native transcription and packaged releases
- `apps/marketing`: public marketing site
- `convex`: Convex backend, auth, schema, actions, and HTTP routes
- `packages/platform`: renderer-safe desktop bridge helpers
- `packages/ui`: shared UI primitives

## Built with

- [Vite](https://vite.dev/) and [React](https://react.dev/) for the renderer
- [Electron](https://www.electronjs.org/) for the desktop shell
- [Convex](https://www.convex.dev/) for realtime backend functions and data
- [Better Auth](https://www.better-auth.com/) for authentication
- [AI SDK](https://sdk.vercel.ai/docs) with [OpenAI](https://openai.com/) by default
- [Tiptap](https://tiptap.dev/) for rich-text note editing
- [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://radix-ui.com), and [Tailwind CSS](https://tailwindcss.com) for UI

## Self-hosting

Graneri is designed to run with your own Convex deployment and your own provider keys.

1. Fork or clone this repository.
2. Copy `.env.example` to `.env.local`.
3. Fill in the Convex URLs, Better Auth secret, site URL, OAuth apps, and AI provider key.
4. Set matching Convex environment variables with the Convex CLI.
5. Run the self-host doctor:

```bash
bun run doctor:self-host
```

Required local/web environment:

| Variable | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Convex deployment used by `bunx convex dev` |
| `CONVEX_SITE_URL` / `VITE_CONVEX_SITE_URL` | Convex HTTP site URL used by Better Auth and API calls |
| `VITE_CONVEX_URL` | Convex client URL used by the renderer |
| `SITE_URL` | Public web origin for auth callbacks and cross-domain auth |
| `BETTER_AUTH_SECRET` | Better Auth signing secret, set in Convex env |
| `OPENAI_API_KEY` | Default AI and transcription provider key |

Optional self-host environment:

| Variable | Purpose |
| --- | --- |
| `SITE_TRUSTED_ORIGINS` | Comma-separated extra origins trusted by Better Auth |
| `VITE_AUTH_PROVIDERS` | Comma-separated visible login providers, for example `github,google` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app credentials |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app credentials |
| `ZOOM_OAUTH_CLIENT_ID` / `ZOOM_OAUTH_CLIENT_SECRET` | Zoom connection credentials |
| `VITE_TERMS_URL` / `VITE_PRIVACY_URL` | Terms and privacy links shown on login |
| `VITE_DESKTOP_DOWNLOAD_URL` | Direct desktop download page or artifact URL |
| `VITE_DESKTOP_RELEASE_API_URL` | Release metadata endpoint used to find desktop assets |

## Desktop builds

Desktop builds require explicit runtime configuration for self-hosted or forked deployments.

```bash
bun --filter=web run build:desktop
bun --filter=desktop run build
bun --filter=desktop run package:mac
```

Useful desktop packaging variables:

| Variable | Purpose |
| --- | --- |
| `GRANERI_DESKTOP_APP_ID` | Electron app id for packaged builds |
| `GRANERI_DESKTOP_PRODUCT_NAME` | Product name used by Electron Builder |
| `GRANERI_HOSTED_CONVEX_URL` | Optional official hosted Convex default for packaged builds |
| `GRANERI_HOSTED_CONVEX_SITE_URL` | Optional official hosted Convex site default |
| `GRANERI_HOSTED_SITE_URL` | Optional official hosted web/site default |
| `VITE_GITHUB_OWNER` / `VITE_GITHUB_REPO` | GitHub release publish and lookup target |

Leave `GRANERI_HOSTED_*` blank for forked or self-hosted builds. Set `CONVEX_URL` / `VITE_CONVEX_URL` and `CONVEX_SITE_URL` / `VITE_CONVEX_SITE_URL` explicitly instead.

## Running locally

```bash
bun install
bun run doctor:self-host
bun dev
```

Common commands:

| Command | Purpose |
| --- | --- |
| `bun dev` | Start web, desktop, and Convex development processes |
| `bun run dev:web` | Start only the web app on port 3000 |
| `bun run dev:desktop` | Start the Electron desktop app |
| `bun run dev:desktop:native` | Start the packaged macOS desktop app for native permission testing |
| `bun run build` | Build all workspaces |
| `bun run test` | Run Vitest and Convex tests |
| `bun run typecheck` | Run TypeScript checks |
| `bun run check` | Run non-mutating Biome checks |

The web app is available at [localhost:3000](http://localhost:3000/).

## Model providers

Graneri ships with OpenAI as the default provider. Because the app uses the AI SDK, it can be adapted to other supported providers.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Graneri is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
