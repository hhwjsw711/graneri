<a href="https://graneri-oss.vercel.app">
  <img alt="Open-source Granola-like Notepad Built with Vite, Electron, AI SDK, and Convex." src="./apps/web/public/preview/graneri.png">
  <h1 align="center">Graneri</h1>
</a>

<p align="center">
  Open-source Granola-like Notepad Built with Vite, Electron, AI SDK, and Convex.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#built-with"><strong>Built with</strong></a> ·
  <a href="#apps"><strong>Apps</strong></a> ·
  <a href="#model-providers"><strong>Model providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy your own</strong></a> ·
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

## Built with

- [Vite](https://vite.dev/)
  - Fast local development with a lightweight frontend toolchain
  - Production builds for the shared Graneri renderer
- [Electron](https://www.electronjs.org/)
  - Native desktop shell for window management and tray support
  - Packaged app distribution for the Graneri desktop client
- [AI SDK](https://sdk.vercel.ai/docs)
  - Text generation and streaming responses across AI features
  - AI-assisted note workflows for drafting and rewriting
- [OpenAI](https://openai.com/)
  - Default model provider for chat and note enhancement
  - Transcription APIs for voice and meeting workflows
- [Convex](https://www.convex.dev/)
  - Realtime backend for auth and synchronized application data
  - Queries, mutations, and HTTP routes for product features
- [Better Auth](https://www.better-auth.com/)
  - Authentication layer for account and session management
  - GitHub and Google provider support for sign-in
- [Tiptap](https://tiptap.dev/)
  - Rich-text editing for note composition inside the editor
  - Template-driven rewriting for structured note generation
- [Shadcn/UI](https://ui.shadcn.com)
  - UI primitives built on [Radix UI](https://radix-ui.com)
  - Styling and layout with [Tailwind CSS](https://tailwindcss.com)

## Apps

- `apps/web`
  - Browser app and shared renderer
- `apps/desktop`
  - Electron desktop app for native transcription and packaged releases
- `apps/marketing`
  - Marketing site for the public Graneri website

## Model providers

Graneri ships with [OpenAI](https://openai.com/) as the default provider. Because the app uses the [AI SDK](https://sdk.vercel.ai/docs), you can adapt it to other providers such as [Anthropic](https://anthropic.com), [Ollama](https://ollama.com), [Cohere](https://cohere.com/), and [other supported providers](https://sdk.vercel.ai/providers/ai-sdk-providers).

## Deploy your own

You can deploy your own version of Graneri to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmurabcd%2Fgraneri&env=VITE_CONVEX_URL,VITE_CONVEX_SITE_URL,CONVEX_SITE_URL,OPENAI_API_KEY,SITE_URL,BETTER_AUTH_SECRET&envDescription=Set%20the%20Convex%20URLs%2C%20OpenAI%20API%20key%2C%20site%20URL%2C%20and%20Better%20Auth%20secret%20for%20your%20deployment.&envLink=https%3A%2F%2Fgithub.com%2Fmurabcd%2Fgraneri%2Fblob%2Fmain%2F.env.example&demo-title=Graneri&demo-description=Open-source%20Granola-like%20Notepad%20Built%20with%20Vite%2C%20Electron%2C%20AI%20SDK%2C%20and%20Convex.&demo-url=https%3A%2F%2Fgraneri-oss.vercel.app)

## Running locally

You will need the environment variables [defined in `.env.example`](.env.example) to run Graneri. It is recommended to use [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables), but a local `.env` file is enough for development.

> Do not commit your `.env` file. It contains secrets that can expose your AI provider and authentication accounts.

```bash
bun install
bun dev
bun run dev:desktop
bun run dev:desktop:native
```

Your app should then be available on [localhost:3000](http://localhost:3000/).
