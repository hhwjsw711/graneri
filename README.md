<a href="#graneri">
  <img alt="Open-source Granola-like notepad built with Vite, Electron, AI SDK, and Convex." src="./apps/web/public/preview/graneri.png">
  <h1 align="center">Graneri</h1>
</a>

<p align="center">
  Open-source Granola-like notepad built with Vite, Electron, AI SDK, and Convex.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a> ·
  <a href="#desktop"><strong>Desktop</strong></a> ·
  <a href="#self-hosting"><strong>Self-hosting</strong></a>
</p>
<br/>

## Status

Graneri is early. Expect bugs.

Desktop is the primary experience. Public desktop builds are not published yet.
The current desktop build is macOS Apple Silicon (arm64) only. Intel Mac,
Windows, and Linux support are planned.

## Features

- Live meeting transcription with notes generated as conversations happen
- AI-powered note refinement for cleaner summaries and better structure
- Custom note templates for repeatable meeting formats and workflows
- Workspace organization for keeping teams, notes, and context aligned
- Desktop meeting workflow with quick capture during active calls
- Calendar-aware setup that prepares notes around scheduled meetings

## Built with

- [Vite](https://vite.dev/) and [React](https://react.dev/) for the renderer
- [Electron](https://www.electronjs.org/) for the desktop shell
- [Convex](https://www.convex.dev/) for realtime backend functions and data
- [Better Auth](https://www.better-auth.com/) for authentication
- [AI SDK](https://sdk.vercel.ai/docs) with [OpenAI](https://openai.com/) by default
- [Tiptap](https://tiptap.dev/) for rich-text note editing
- [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://radix-ui.com), and [Tailwind CSS](https://tailwindcss.com) for UI

## Running locally

```bash
bun install
bun run doctor:self-host
bun dev
```

Copy `.env.example` to `.env.local` and fill in the Convex, auth, and OpenAI values first.

The web app runs at [localhost:3000](http://localhost:3000/).

## Desktop

Graneri is desktop-first. For now, build the desktop app from source:

```bash
bun run dist:mac
```

This currently creates a macOS Apple Silicon (arm64) package. Published desktop
builds and broader platform support will come later.

## Self-hosting

Self-hosting requires your own Convex deployment, OAuth apps, and AI provider key. See `.env.example`.

Run this after filling env values:

```bash
bun run doctor:self-host
```

## Project structure

- `apps/web`: browser app and shared renderer
- `apps/desktop`: Electron desktop app
- `apps/marketing`: public marketing site
- `convex`: Convex backend, auth, schema, actions, and HTTP routes
- `packages/platform`: renderer-safe desktop bridge helpers
- `packages/ui`: shared UI primitives

## Model providers

Graneri ships with OpenAI as the default provider. Because the app uses the AI SDK, it can be adapted to other supported providers.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Graneri is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
