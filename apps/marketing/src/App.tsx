import { Button } from "@workspace/ui/components/button";
import { GraneriMark } from "@workspace/ui/components/graneri-mark";
import { Icons } from "@workspace/ui/components/icons";

const githubOwner = import.meta.env.VITE_GITHUB_OWNER?.trim() || "murabcd";
const githubRepo = import.meta.env.VITE_GITHUB_REPO?.trim() || "graneri";
const githubProjectUrl = `https://github.com/${githubOwner}/${githubRepo}`;
const GithubLogo = Icons.githubLogo;

function App() {
	return (
		<div className="dark min-h-screen bg-background text-foreground">
			<div className="marketing-noise" />
			<main
				id="top"
				className="relative isolate mx-auto flex min-h-screen max-w-7xl items-center justify-center px-6 py-16 md:px-8"
			>
				<section className="mx-auto flex max-w-5xl flex-col items-center text-center">
					<a
						href={githubProjectUrl}
						target="_blank"
						rel="noreferrer"
						aria-label="Graneri on GitHub"
						className="group flex items-center self-center text-foreground transition-opacity hover:opacity-80"
					>
						<span className="relative flex size-10 items-center justify-center rounded-xl text-foreground">
							<GraneriMark className="size-5 transition-opacity duration-150 group-hover:opacity-0" />
							<GithubLogo className="absolute size-4.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
						</span>
					</a>
					<h1 className="marketing-display mt-8 text-[clamp(3.55rem,7vw,6.4rem)] leading-[0.88] font-normal tracking-[-0.07em] text-balance">
						<span className="block">AI meeting notes</span>
						<span className="block">for people who</span>
						<span className="block">move fast</span>
					</h1>
					<p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
						Graneri captures the conversation, untangles the noise, and leaves
						you with notes that are ready before the next call steals your
						attention.
					</p>
					<div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
						<Button
							asChild
							size="lg"
							className="h-13 rounded-full border-0 bg-primary px-7 text-base font-medium text-primary-foreground shadow-[0_22px_50px_rgba(0,0,0,0.34)] hover:bg-primary/90"
						>
							<a href={githubProjectUrl} target="_blank" rel="noreferrer">
								<GithubLogo className="size-4.5" />
								View source
							</a>
						</Button>
					</div>
				</section>
			</main>
		</div>
	);
}

export default App;
