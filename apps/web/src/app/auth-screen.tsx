import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@workspace/ui/components/field";
import { GraneriMark } from "@workspace/ui/components/graneri-mark";
import { Icons } from "@workspace/ui/components/icons";
import { cn } from "@workspace/ui/lib/utils";
import { AlertCircle, LoaderCircle } from "lucide-react";
import * as React from "react";
import type { SocialAuthProvider } from "@/app/app-types";
import { DESKTOP_AUTH_SAFE_TOP_CLASS } from "@/lib/desktop-chrome";

const GoogleLogo = Icons.googleLogo;
const GithubLogo = Icons.githubLogo;
const termsUrl = import.meta.env.VITE_TERMS_URL?.trim() || "/terms";
const privacyUrl = import.meta.env.VITE_PRIVACY_URL?.trim() || "/privacy";
const enabledAuthProviders = new Set(
	(import.meta.env.VITE_AUTH_PROVIDERS ?? "github,google")
		.split(",")
		.flatMap((provider) => {
			const normalizedProvider = provider.trim().toLowerCase();
			return normalizedProvider ? [normalizedProvider] : [];
		}),
);

export function AuthScreen({
	error,
	isAuthenticating,
	authenticatingProvider,
	isDesktopMac,
	onGitHubSignIn,
	onGoogleSignIn,
}: {
	error: string | null;
	isAuthenticating: boolean;
	authenticatingProvider: SocialAuthProvider | null;
	isDesktopMac: boolean;
	onGitHubSignIn: () => void;
	onGoogleSignIn: () => void;
}) {
	return (
		<div
			data-app-region={isDesktopMac ? "drag" : undefined}
			className={cn(
				"flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10",
				isDesktopMac && DESKTOP_AUTH_SAFE_TOP_CLASS,
			)}
		>
			<LoginForm
				error={error}
				isAuthenticating={isAuthenticating}
				authenticatingProvider={authenticatingProvider}
				isDesktopMac={isDesktopMac}
				onGitHubSignIn={onGitHubSignIn}
				onGoogleSignIn={onGoogleSignIn}
			/>
		</div>
	);
}

function LoginForm({
	className,
	error,
	isAuthenticating,
	authenticatingProvider,
	isDesktopMac,
	onGitHubSignIn,
	onGoogleSignIn,
	...props
}: React.ComponentProps<"div"> & {
	error: string | null;
	isAuthenticating: boolean;
	authenticatingProvider: SocialAuthProvider | null;
	isDesktopMac: boolean;
	onGitHubSignIn: () => void;
	onGoogleSignIn: () => void;
}) {
	const [hasAcceptedTerms, setHasAcceptedTerms] = React.useState(false);

	return (
		<div
			data-app-region={isDesktopMac ? "no-drag" : undefined}
			className={cn("flex w-full max-w-sm flex-col gap-6", className)}
			{...props}
		>
			<div className="flex items-center gap-2 self-center font-medium">
				<div className="flex size-6 items-center justify-center rounded-md border bg-card text-foreground">
					<GraneriMark className="size-4" />
				</div>
				Graneri
			</div>
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Welcome back</CardTitle>
					<CardDescription>
						Login with a configured authentication provider
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form>
						<FieldGroup>
							{enabledAuthProviders.has("google") ? (
								<Field>
									<Button
										variant="outline"
										type="button"
										className="w-full"
										onClick={onGoogleSignIn}
										disabled={isAuthenticating || !hasAcceptedTerms}
									>
										{authenticatingProvider === "google" ? (
											<LoaderCircle className="animate-spin" />
										) : (
											<GoogleLogo className="size-4" />
										)}
										Login with Google
									</Button>
								</Field>
							) : null}
							{enabledAuthProviders.has("github") ? (
								<Field>
									<Button
										variant="outline"
										type="button"
										className="w-full"
										onClick={onGitHubSignIn}
										disabled={isAuthenticating || !hasAcceptedTerms}
									>
										{authenticatingProvider === "github" ? (
											<LoaderCircle className="animate-spin" />
										) : (
											<GithubLogo />
										)}
										Login with GitHub
									</Button>
								</Field>
							) : null}
							{enabledAuthProviders.size === 0 ? (
								<Field>
									<FieldDescription className="text-center text-muted-foreground">
										No authentication providers are configured.
									</FieldDescription>
								</Field>
							) : null}
							{error ? (
								<Field>
									<FieldDescription className="flex items-center justify-center gap-2 text-center text-destructive">
										<AlertCircle className="size-4 shrink-0" />
										<span>{error}</span>
									</FieldDescription>
								</Field>
							) : null}
							<Field orientation="horizontal">
								<Checkbox
									id="terms"
									checked={hasAcceptedTerms}
									onCheckedChange={(checked) =>
										setHasAcceptedTerms(checked === true)
									}
								/>
								<FieldLabel
									htmlFor="terms"
									className="text-xs leading-none font-normal whitespace-nowrap text-muted-foreground"
								>
									I agree to the{" "}
									<a href={termsUrl} className="underline underline-offset-4">
										Terms of Service
									</a>{" "}
									and{" "}
									<a href={privacyUrl} className="underline underline-offset-4">
										Privacy Policy
									</a>
									.
								</FieldLabel>
							</Field>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
