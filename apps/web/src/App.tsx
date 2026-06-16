import {
	getDesktopAuthCallbackUrl,
	getDesktopMeta,
	getDesktopPermissionsStatus,
	isDesktopRuntime,
	openDesktopPermissionSettings,
	requestDesktopPermission,
} from "@workspace/platform/desktop";
import type {
	DesktopPermissionId,
	DesktopPermissionState,
	DesktopPermissionsStatus,
	DesktopPlatform,
} from "@workspace/platform/desktop-bridge";
import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import { Field } from "@workspace/ui/components/field";
import { GraneriMark } from "@workspace/ui/components/graneri-mark";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import confetti from "canvas-confetti";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
	Check,
	ExternalLink,
	LoaderCircle,
	Mic,
	TriangleAlert,
	Volume2,
} from "lucide-react";
import * as React from "react";
import type { SocialAuthProvider } from "@/app/app-types";
import { AuthScreen } from "@/app/auth-screen";
import { AuthenticatedAppShell } from "@/app/authenticated-app-shell";
import { getSharedNoteShareId, getThemeFireworkColors } from "@/app/location";
import { SharedNotePageEntry } from "@/components/note/shared-note-page-entry";
import { WorkspaceComposer } from "@/components/workspaces/workspace-composer";
import { type AuthSession, authClient } from "@/lib/auth-client";
import { DESKTOP_AUTH_SAFE_TOP_CLASS } from "@/lib/desktop-chrome";
import { useNavigationHistoryShortcuts } from "@/lib/navigation-history-state";
import {
	getSuggestedWorkspaceName,
	type WorkspaceRecord,
} from "@/lib/workspaces";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

type DesktopPermissionRow = {
	id: DesktopPermissionId;
	description: string;
	label: string;
	state: DesktopPermissionState;
	required: boolean;
	canRequest: boolean;
	canOpenSystemSettings: boolean;
};

const isMissingDesktopPermissionHandlerError = (error: unknown) =>
	error instanceof Error &&
	error.message.includes(
		"No handler registered for 'app:get-permissions-status'",
	);
const DESKTOP_PERMISSION_LABELS: Record<DesktopPermissionId, string> = {
	microphone: "Transcribe me",
	systemAudio: "Transcribe others",
};
const DESKTOP_PERMISSION_BUTTON_LABELS: Record<DesktopPermissionId, string> = {
	microphone: "Enable",
	systemAudio: "Enable",
};

const useAppBootstrapState = () => {
	const { data: session, isPending: isSessionPending } =
		authClient.useSession();
	const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
	const [authError, setAuthError] = React.useState<string | null>(null);
	const [authenticatingProvider, setAuthenticatingProvider] =
		React.useState<SocialAuthProvider | null>(null);
	const [isCreatingWorkspace, startWorkspaceCreation] = React.useTransition();
	const [isDesktopMac, setIsDesktopMac] = React.useState(false);
	const [desktopPlatform, setDesktopPlatform] =
		React.useState<DesktopPlatform>("darwin");
	const [workspaceName, setWorkspaceName] = React.useState("");
	const [workspaceError, setWorkspaceError] = React.useState<string | null>(
		null,
	);
	const [desktopPermissionsError, setDesktopPermissionsError] = React.useState<
		string | null
	>(null);
	const [desktopPermissionsStatus, setDesktopPermissionsStatus] =
		React.useState<DesktopPermissionsStatus | null>(null);
	const [isRefreshingDesktopPermissions, startDesktopPermissionsRefresh] =
		React.useTransition();
	const [activeDesktopPermissionId, setActiveDesktopPermissionId] =
		React.useState<DesktopPermissionId | null>(null);
	const [isCompletingDesktopPermissions, startDesktopPermissionsCompletion] =
		React.useTransition();
	const workspaceNameSeededForRef = React.useRef<string | null>(null);
	const [sharedNoteShareId, setSharedNoteShareId] = React.useState<
		string | null
	>(() => {
		if (typeof window === "undefined") {
			return null;
		}

		return getSharedNoteShareId(window.location.pathname);
	});
	const sharedNote = useQuery(
		api.notes.getShared,
		sharedNoteShareId
			? {
					shareId: sharedNoteShareId,
				}
			: "skip",
	);
	const workspaces = useQuery(
		api.workspaces.list,
		session?.user && isConvexAuthenticated ? {} : "skip",
	);
	const onboardingStatus = useQuery(
		api.onboarding.getStatus,
		session?.user && isConvexAuthenticated ? {} : "skip",
	);
	const createWorkspace = useMutation(api.workspaces.create);
	const markWelcomeCelebrationSeen = useMutation(
		api.onboarding.markWelcomeCelebrationSeen,
	);
	const markDesktopPermissionsCompleted = useMutation(
		api.onboarding.markDesktopPermissionsCompleted,
	);
	const isDesktopApp = isDesktopRuntime();

	const applyDesktopMeta = React.useCallback((platform: DesktopPlatform) => {
		setIsDesktopMac(platform === "darwin");
		setDesktopPlatform(platform);
	}, []);

	const resetDesktopPermissionsState = React.useCallback(() => {
		setDesktopPermissionsError(null);
		setDesktopPermissionsStatus(null);
	}, []);

	const applyDesktopPermissionsError = React.useCallback((message: string) => {
		setDesktopPermissionsError(message);
	}, []);

	const applyDesktopPermissionsStatus = React.useCallback(
		(status: DesktopPermissionsStatus | null) => {
			setDesktopPermissionsStatus(status);
		},
		[],
	);

	const applyLegacyDesktopPermissionsFallback = React.useCallback(
		(platform: DesktopPlatform) => {
			applyDesktopPermissionsStatus({
				isDesktop: true,
				platform,
				permissions: [
					{
						id: "microphone",
						description:
							"During your meetings, Graneri transcribes your microphone.",
						required: true,
						state: "unknown",
						canRequest: false,
						canOpenSystemSettings: false,
					},
					{
						id: "systemAudio",
						description:
							"During your meetings, Graneri transcribes your system audio output.",
						required: false,
						state: "unknown",
						canRequest: false,
						canOpenSystemSettings: false,
					},
				],
			});
			applyDesktopPermissionsError(
				"Desktop permissions are unavailable because the Electron shell is still running an older build. Restart the desktop app, then try again.",
			);
		},
		[applyDesktopPermissionsError, applyDesktopPermissionsStatus],
	);

	React.useEffect(() => {
		void getDesktopMeta()
			.then((meta) => {
				if (meta) {
					applyDesktopMeta(meta.platform);
				}
			})
			.catch(() => {
				setIsDesktopMac(false);
			});
	}, [applyDesktopMeta]);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const url = new URL(window.location.href);
		const authErrorParam = url.searchParams.get("authError");
		if (!authErrorParam) {
			return;
		}

		const authErrorDescription = url.searchParams.get("authErrorDescription");
		const message = authErrorDescription
			? `${authErrorParam}: ${authErrorDescription}`
			: authErrorParam.replaceAll("_", " ");

		// react-doctor-disable-next-line react-doctor/no-initialize-state
		setAuthError(message);
		url.searchParams.delete("authError");
		url.searchParams.delete("authErrorDescription");
		window.history.replaceState({}, "", url);
	}, []);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const syncSharedNoteRoute = () => {
			setSharedNoteShareId(getSharedNoteShareId(window.location.pathname));
		};

		// react-doctor-disable-next-line react-doctor/no-initialize-state
		syncSharedNoteRoute();
		window.addEventListener("popstate", syncSharedNoteRoute);

		return () => {
			window.removeEventListener("popstate", syncSharedNoteRoute);
		};
	}, []);

	const syncDesktopPermissions = React.useCallback(async () => {
		const status = await getDesktopPermissionsStatus();

		if (!status) {
			applyDesktopPermissionsStatus(null);
			return null;
		}

		applyDesktopPermissionsStatus(status);
		return status;
	}, [applyDesktopPermissionsStatus]);

	const isAuthenticating = authenticatingProvider !== null;

	const handleSocialSignIn = React.useCallback(
		async (provider: SocialAuthProvider) => {
			if (authenticatingProvider) {
				return;
			}

			setAuthenticatingProvider(provider);

			try {
				setAuthError(null);
				const callbackURL = await getDesktopAuthCallbackUrl(
					window.location.href,
				);

				await authClient.signIn.social({
					provider,
					callbackURL,
					errorCallbackURL: callbackURL,
					disableRedirect: isDesktopRuntime(),
				});
			} catch (error) {
				setAuthError(
					error instanceof Error
						? error.message
						: `${provider === "google" ? "Google" : "GitHub"} sign-in failed. Check your Better Auth setup.`,
				);
			} finally {
				setAuthenticatingProvider(null);
			}
		},
		[authenticatingProvider],
	);

	const handleGitHubSignIn = React.useCallback(() => {
		handleSocialSignIn("github");
	}, [handleSocialSignIn]);

	const handleGoogleSignIn = React.useCallback(() => {
		handleSocialSignIn("google");
	}, [handleSocialSignIn]);

	const handleOpenOwnedSharedNote = React.useCallback((noteId: Id<"notes">) => {
		setSharedNoteShareId(null);
		window.history.pushState(null, "", `/note?noteId=${noteId}`);
	}, []);

	React.useEffect(() => {
		const userEmail = session?.user?.email ?? null;
		const userName = session?.user?.name ?? null;

		if (!userEmail || !userName) {
			workspaceNameSeededForRef.current = null;
			return;
		}

		if (workspaceNameSeededForRef.current === userEmail) {
			return;
		}

		workspaceNameSeededForRef.current = userEmail;
		setWorkspaceName((currentName) =>
			currentName.trim() ? currentName : getSuggestedWorkspaceName(userName),
		);
	}, [session?.user?.email, session?.user?.name]);

	const handleCreateWorkspace = React.useCallback(() => {
		startWorkspaceCreation(async () => {
			try {
				setWorkspaceError(null);
				await createWorkspace({
					name: workspaceName,
				});
			} catch (error) {
				setWorkspaceError(
					error instanceof Error
						? error.message
						: "Failed to create workspace.",
				);
			}
		});
	}, [createWorkspace, workspaceName]);
	const handleContinueFromWelcomeCelebration = React.useCallback(() => {
		startWorkspaceCreation(async () => {
			try {
				await markWelcomeCelebrationSeen({});
			} catch (error) {
				setWorkspaceError(
					error instanceof Error
						? error.message
						: "Failed to continue onboarding.",
				);
			}
		});
	}, [markWelcomeCelebrationSeen]);

	const shouldLoadDesktopPermissions =
		isDesktopApp &&
		Boolean(session?.user) &&
		isConvexAuthenticated &&
		workspaces !== undefined &&
		workspaces.length > 0 &&
		onboardingStatus !== undefined &&
		!onboardingStatus.hasCompletedDesktopPermissions;

	React.useEffect(() => {
		if (!shouldLoadDesktopPermissions) {
			// react-doctor-disable-next-line react-doctor/no-chain-state-updates, react-doctor/no-derived-state
			resetDesktopPermissionsState();
			return;
		}

		void syncDesktopPermissions().catch((error) => {
			if (isMissingDesktopPermissionHandlerError(error)) {
				applyLegacyDesktopPermissionsFallback(desktopPlatform);
				return;
			}

			applyDesktopPermissionsError(
				error instanceof Error
					? error.message
					: "Failed to load desktop permissions.",
			);
		});
	}, [
		applyDesktopPermissionsError,
		applyLegacyDesktopPermissionsFallback,
		desktopPlatform,
		resetDesktopPermissionsState,
		shouldLoadDesktopPermissions,
		syncDesktopPermissions,
	]);

	React.useEffect(() => {
		if (!shouldLoadDesktopPermissions) {
			return;
		}

		const refreshPermissions = () => {
			void syncDesktopPermissions().catch(() => {});
		};

		window.addEventListener("focus", refreshPermissions);

		return () => {
			window.removeEventListener("focus", refreshPermissions);
		};
	}, [shouldLoadDesktopPermissions, syncDesktopPermissions]);

	const handleRequestDesktopPermission = React.useCallback(
		(permissionId: DesktopPermissionId) => {
			setActiveDesktopPermissionId(permissionId);
			startDesktopPermissionsRefresh(async () => {
				try {
					setDesktopPermissionsError(null);

					const status = await requestDesktopPermission(permissionId);

					if (!status) {
						throw new Error("Desktop permissions are unavailable.");
					}

					setDesktopPermissionsStatus(status);
				} catch (error) {
					setDesktopPermissionsError(
						error instanceof Error
							? error.message
							: "Failed to request desktop permission.",
					);
				} finally {
					setActiveDesktopPermissionId(null);
				}
			});
		},
		[],
	);

	const handleOpenDesktopPermissionSettings = React.useCallback(
		(permissionId: DesktopPermissionId) => {
			setActiveDesktopPermissionId(permissionId);
			startDesktopPermissionsRefresh(async () => {
				try {
					setDesktopPermissionsError(null);

					if (!(await openDesktopPermissionSettings(permissionId))) {
						throw new Error("Desktop permissions are unavailable.");
					}

					await syncDesktopPermissions();
				} catch (error) {
					setDesktopPermissionsError(
						error instanceof Error
							? error.message
							: "Failed to open system settings.",
					);
				} finally {
					setActiveDesktopPermissionId(null);
				}
			});
		},
		[syncDesktopPermissions],
	);

	const handleCompleteDesktopPermissions = React.useCallback(() => {
		startDesktopPermissionsCompletion(async () => {
			try {
				setDesktopPermissionsError(null);
				await markDesktopPermissionsCompleted({});
			} catch (error) {
				setDesktopPermissionsError(
					error instanceof Error
						? error.message
						: "Failed to finish desktop onboarding.",
				);
			}
		});
	}, [markDesktopPermissionsCompleted]);

	const desktopPermissionRows: DesktopPermissionRow[] = (
		desktopPermissionsStatus?.permissions ?? []
	).map((permission) => ({
		...permission,
		label: DESKTOP_PERMISSION_LABELS[permission.id],
	}));
	const shouldShowDesktopPermissionsScreen =
		shouldLoadDesktopPermissions && desktopPermissionRows.length > 0;
	const requiredDesktopPermissionRows = desktopPermissionRows.filter(
		(permission) => permission.required,
	);
	const systemAudioPermissionRow = desktopPermissionRows.find(
		(permission) => permission.id === "systemAudio",
	);
	const areDesktopPermissionsReady =
		requiredDesktopPermissionRows.length > 0 &&
		requiredDesktopPermissionRows.every(
			(permission) => permission.state === "granted",
		) &&
		(!isDesktopMac ||
			!systemAudioPermissionRow ||
			systemAudioPermissionRow.state === "granted" ||
			systemAudioPermissionRow.state === "unsupported");

	return {
		activeDesktopPermissionId,
		areDesktopPermissionsReady,
		authError,
		authenticatingProvider,
		desktopPermissionRows,
		desktopPermissionsError,
		desktopPermissionsStatus,
		handleCompleteDesktopPermissions,
		handleContinueFromWelcomeCelebration,
		handleCreateWorkspace,
		handleGitHubSignIn,
		handleGoogleSignIn,
		handleOpenDesktopPermissionSettings,
		handleOpenOwnedSharedNote,
		handleRequestDesktopPermission,
		isAuthenticating,
		isCompletingDesktopPermissions,
		isConvexAuthenticated,
		isCreatingWorkspace,
		isDesktopApp,
		isDesktopMac,
		isRefreshingDesktopPermissions,
		isSessionPending,
		onboardingStatus,
		session,
		sharedNote,
		sharedNoteShareId,
		shouldLoadDesktopPermissions,
		shouldShowDesktopPermissionsScreen,
		workspaceError,
		workspaceName,
		workspaces,
		setWorkspaceName,
	};
};

function MainApp() {
	const controller = useAppBootstrapState();

	if (controller.sharedNoteShareId) {
		return (
			<ScrollArea className="h-svh" viewportClassName="overscroll-contain">
				<SharedNotePageEntry
					note={controller.sharedNote}
					onOpenNote={controller.handleOpenOwnedSharedNote}
				/>
			</ScrollArea>
		);
	}

	if (
		controller.isSessionPending ||
		(controller.session?.user && !controller.isConvexAuthenticated)
	) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={controller.isDesktopApp}
				isDesktopMac={controller.isDesktopMac}
			/>
		);
	}

	if (!controller.session?.user) {
		return (
			<AuthScreen
				error={controller.authError}
				isAuthenticating={controller.isAuthenticating}
				authenticatingProvider={controller.authenticatingProvider}
				isDesktopMac={controller.isDesktopMac}
				onGitHubSignIn={controller.handleGitHubSignIn}
				onGoogleSignIn={controller.handleGoogleSignIn}
			/>
		);
	}

	if (controller.workspaces === undefined) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={controller.isDesktopApp}
				isDesktopMac={controller.isDesktopMac}
			/>
		);
	}

	if (controller.onboardingStatus === undefined) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={controller.isDesktopApp}
				isDesktopMac={controller.isDesktopMac}
			/>
		);
	}

	if (controller.workspaces.length === 0) {
		if (!controller.onboardingStatus.hasSeenWelcomeCelebration) {
			return (
				<WelcomeCelebrationScreen
					isDesktopMac={controller.isDesktopMac}
					isSubmitting={controller.isCreatingWorkspace}
					onContinue={controller.handleContinueFromWelcomeCelebration}
				/>
			);
		}

		return (
			<WorkspaceOnboardingScreen
				error={controller.workspaceError}
				isDesktopMac={controller.isDesktopMac}
				isSubmitting={controller.isCreatingWorkspace}
				name={controller.workspaceName}
				onNameChange={controller.setWorkspaceName}
				onSubmit={controller.handleCreateWorkspace}
			/>
		);
	}

	if (
		controller.shouldLoadDesktopPermissions &&
		controller.desktopPermissionsStatus === null
	) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={controller.isDesktopApp}
				isDesktopMac={controller.isDesktopMac}
			/>
		);
	}

	if (controller.shouldShowDesktopPermissionsScreen) {
		return (
			<DesktopPermissionsOnboardingScreen
				error={controller.desktopPermissionsError}
				activePermissionId={controller.activeDesktopPermissionId}
				permissions={controller.desktopPermissionRows}
				status={{
					isDesktopMac: controller.isDesktopMac,
					isRefreshing: controller.isRefreshingDesktopPermissions,
					isSubmitting: controller.isCompletingDesktopPermissions,
					canContinue: controller.areDesktopPermissionsReady,
				}}
				onContinue={controller.handleCompleteDesktopPermissions}
				onOpenSettings={controller.handleOpenDesktopPermissionSettings}
				onRequestPermission={controller.handleRequestDesktopPermission}
			/>
		);
	}

	return (
		<AppGate
			sharedNoteShareId={controller.sharedNoteShareId}
			sharedNote={controller.sharedNote}
			authState={{
				isSessionPending: controller.isSessionPending,
				isConvexAuthenticated: controller.isConvexAuthenticated,
				isAuthenticating: controller.isAuthenticating,
				isDesktopApp: controller.isDesktopApp,
				isDesktopMac: controller.isDesktopMac,
			}}
			session={controller.session}
			authError={controller.authError}
			authenticatingProvider={controller.authenticatingProvider}
			onGitHubSignIn={controller.handleGitHubSignIn}
			onGoogleSignIn={controller.handleGoogleSignIn}
			workspaces={controller.workspaces}
			onboardingStatus={controller.onboardingStatus}
			workspaceState={{
				isCreatingWorkspace: controller.isCreatingWorkspace,
			}}
			onContinueFromWelcomeCelebration={
				controller.handleContinueFromWelcomeCelebration
			}
			workspaceError={controller.workspaceError}
			workspaceName={controller.workspaceName}
			onWorkspaceNameChange={controller.setWorkspaceName}
			onCreateWorkspace={controller.handleCreateWorkspace}
			desktopPermissionsStatus={controller.desktopPermissionsStatus}
			desktopPermissionState={{
				shouldLoadDesktopPermissions: controller.shouldLoadDesktopPermissions,
				shouldShowDesktopPermissionsScreen:
					controller.shouldShowDesktopPermissionsScreen,
				isRefreshingDesktopPermissions:
					controller.isRefreshingDesktopPermissions,
				isCompletingDesktopPermissions:
					controller.isCompletingDesktopPermissions,
				areDesktopPermissionsReady: controller.areDesktopPermissionsReady,
			}}
			desktopPermissionsError={controller.desktopPermissionsError}
			activeDesktopPermissionId={controller.activeDesktopPermissionId}
			desktopPermissionRows={controller.desktopPermissionRows}
			onCompleteDesktopPermissions={controller.handleCompleteDesktopPermissions}
			onOpenDesktopPermissionSettings={
				controller.handleOpenDesktopPermissionSettings
			}
			onRequestDesktopPermission={controller.handleRequestDesktopPermission}
			onOpenOwnedSharedNote={controller.handleOpenOwnedSharedNote}
		/>
	);
}

function App() {
	useNavigationHistoryShortcuts();

	return <MainApp />;
}

function AppGate({
	sharedNoteShareId,
	sharedNote,
	authState,
	session,
	authError,
	authenticatingProvider,
	onGitHubSignIn,
	onGoogleSignIn,
	workspaces,
	onboardingStatus,
	workspaceState,
	onContinueFromWelcomeCelebration,
	workspaceError,
	workspaceName,
	onWorkspaceNameChange,
	onCreateWorkspace,
	desktopPermissionsStatus,
	desktopPermissionState,
	desktopPermissionsError,
	activeDesktopPermissionId,
	desktopPermissionRows,
	onCompleteDesktopPermissions,
	onOpenDesktopPermissionSettings,
	onRequestDesktopPermission,
	onOpenOwnedSharedNote,
}: {
	sharedNoteShareId: string | null;
	sharedNote: Doc<"notes"> | null | undefined;
	authState: {
		isSessionPending: boolean;
		isConvexAuthenticated: boolean;
		isAuthenticating: boolean;
		isDesktopApp: boolean;
		isDesktopMac: boolean;
	};
	session: AuthSession | null | undefined;
	authError: string | null;
	authenticatingProvider: SocialAuthProvider | null;
	onGitHubSignIn: () => void;
	onGoogleSignIn: () => void;
	workspaces: Array<WorkspaceRecord> | undefined;
	onboardingStatus:
		| {
				hasSeenWelcomeCelebration: boolean;
				hasCompletedDesktopPermissions: boolean;
		  }
		| null
		| undefined;
	workspaceState: {
		isCreatingWorkspace: boolean;
	};
	onContinueFromWelcomeCelebration: () => void;
	workspaceError: string | null;
	workspaceName: string;
	onWorkspaceNameChange: (value: string) => void;
	onCreateWorkspace: () => void;
	desktopPermissionsStatus: DesktopPermissionsStatus | null;
	desktopPermissionState: {
		shouldLoadDesktopPermissions: boolean;
		shouldShowDesktopPermissionsScreen: boolean;
		isRefreshingDesktopPermissions: boolean;
		isCompletingDesktopPermissions: boolean;
		areDesktopPermissionsReady: boolean;
	};
	desktopPermissionsError: string | null;
	activeDesktopPermissionId: DesktopPermissionId | null;
	desktopPermissionRows: DesktopPermissionRow[];
	onCompleteDesktopPermissions: () => void;
	onOpenDesktopPermissionSettings: (permissionId: DesktopPermissionId) => void;
	onRequestDesktopPermission: (permissionId: DesktopPermissionId) => void;
	onOpenOwnedSharedNote: (noteId: Id<"notes">) => void;
}) {
	const {
		isSessionPending,
		isConvexAuthenticated,
		isAuthenticating,
		isDesktopApp,
		isDesktopMac,
	} = authState;
	const { isCreatingWorkspace } = workspaceState;
	const {
		shouldLoadDesktopPermissions,
		shouldShowDesktopPermissionsScreen,
		isRefreshingDesktopPermissions,
		isCompletingDesktopPermissions,
		areDesktopPermissionsReady,
	} = desktopPermissionState;
	if (sharedNoteShareId) {
		return (
			<ScrollArea className="h-svh" viewportClassName="overscroll-contain">
				<SharedNotePageEntry
					note={sharedNote}
					onOpenNote={onOpenOwnedSharedNote}
				/>
			</ScrollArea>
		);
	}

	if (isSessionPending || (session?.user && !isConvexAuthenticated)) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={isDesktopApp}
				isDesktopMac={isDesktopMac}
			/>
		);
	}

	if (!session?.user) {
		return (
			<AuthScreen
				error={authError}
				isAuthenticating={isAuthenticating}
				authenticatingProvider={authenticatingProvider}
				isDesktopMac={isDesktopMac}
				onGitHubSignIn={onGitHubSignIn}
				onGoogleSignIn={onGoogleSignIn}
			/>
		);
	}

	if (workspaces === undefined || onboardingStatus == null) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={isDesktopApp}
				isDesktopMac={isDesktopMac}
			/>
		);
	}

	if (workspaces.length === 0) {
		if (!onboardingStatus.hasSeenWelcomeCelebration) {
			return (
				<WelcomeCelebrationScreen
					isDesktopMac={isDesktopMac}
					isSubmitting={isCreatingWorkspace}
					onContinue={onContinueFromWelcomeCelebration}
				/>
			);
		}

		return (
			<WorkspaceOnboardingScreen
				error={workspaceError}
				isDesktopMac={isDesktopMac}
				isSubmitting={isCreatingWorkspace}
				name={workspaceName}
				onNameChange={onWorkspaceNameChange}
				onSubmit={onCreateWorkspace}
			/>
		);
	}

	if (shouldLoadDesktopPermissions && desktopPermissionsStatus === null) {
		return (
			<AuthBootstrapScreen
				isDesktopApp={isDesktopApp}
				isDesktopMac={isDesktopMac}
			/>
		);
	}

	if (shouldShowDesktopPermissionsScreen) {
		return (
			<DesktopPermissionsOnboardingScreen
				error={desktopPermissionsError}
				activePermissionId={activeDesktopPermissionId}
				permissions={desktopPermissionRows}
				status={{
					isDesktopMac,
					isRefreshing: isRefreshingDesktopPermissions,
					isSubmitting: isCompletingDesktopPermissions,
					canContinue: areDesktopPermissionsReady,
				}}
				onContinue={onCompleteDesktopPermissions}
				onOpenSettings={onOpenDesktopPermissionSettings}
				onRequestPermission={onRequestDesktopPermission}
			/>
		);
	}

	return (
		<AuthenticatedAppShell
			session={session}
			workspaces={workspaces}
			initialDesktopMac={isDesktopMac}
		/>
	);
}

function OnboardingStepBrand() {
	return (
		<div className="flex items-center gap-2 self-center font-medium">
			<div className="flex size-6 items-center justify-center rounded-md border bg-card text-foreground">
				<GraneriMark className="size-4" />
			</div>
			Graneri
		</div>
	);
}

function OnboardingStepLayout({
	background,
	children,
	className,
	contentClassName,
	isDesktopMac,
}: React.PropsWithChildren<{
	background?: React.ReactNode;
	className?: string;
	contentClassName?: string;
	isDesktopMac: boolean;
}>) {
	return (
		<div
			data-app-region={isDesktopMac ? "drag" : undefined}
			className={cn(
				"flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10",
				isDesktopMac && DESKTOP_AUTH_SAFE_TOP_CLASS,
				className,
			)}
		>
			{background}
			<div
				data-app-region={isDesktopMac ? "no-drag" : undefined}
				className={cn("flex w-full max-w-sm flex-col gap-6", contentClassName)}
			>
				<OnboardingStepBrand />
				{children}
			</div>
		</div>
	);
}

function OnboardingStepCard({
	children,
	contentClassName,
	description,
	title,
}: React.PropsWithChildren<{
	contentClassName?: string;
	description: React.ReactNode;
	title: React.ReactNode;
}>) {
	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className={contentClassName}>{children}</CardContent>
		</Card>
	);
}

function WelcomeCelebrationScreen({
	isDesktopMac,
	isSubmitting,
	onContinue,
}: {
	isDesktopMac: boolean;
	isSubmitting: boolean;
	onContinue: () => void;
}) {
	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

	React.useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}

		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			return;
		}

		let isCancelled = false;
		let cleanupFireworks: (() => void) | undefined;
		let timeoutId: number | undefined;

		const launchFireworks = async () => {
			if (isCancelled) {
				return;
			}

			const fire = confetti.create(canvas, {
				resize: true,
				useWorker: true,
			});
			const endTime = Date.now() + 500;

			const burst = () => {
				if (isCancelled) {
					return;
				}

				const originY = 0.15 + Math.random() * 0.25;
				fire({
					angle: 60,
					colors: getThemeFireworkColors(),
					disableForReducedMotion: true,
					gravity: 0.95,
					origin: { x: 0.1 + Math.random() * 0.25, y: originY },
					particleCount: 20,
					scalar: 1.05,
					spread: 55,
					startVelocity: 52,
				});
				fire({
					angle: 120,
					colors: getThemeFireworkColors(),
					disableForReducedMotion: true,
					gravity: 0.95,
					origin: { x: 0.65 + Math.random() * 0.2, y: originY + 0.05 },
					particleCount: 20,
					scalar: 1.05,
					spread: 55,
					startVelocity: 52,
				});
				fire({
					colors: getThemeFireworkColors(),
					disableForReducedMotion: true,
					gravity: 1.1,
					origin: { x: 0.35 + Math.random() * 0.3, y: originY - 0.05 },
					particleCount: 28,
					scalar: 0.9,
					spread: 90,
					startVelocity: 38,
				});

				if (Date.now() >= endTime) {
					return;
				}

				timeoutId = window.setTimeout(burst, 260 + Math.random() * 180);
			};

			if (!isCancelled) {
				burst();
				cleanupFireworks = () => {
					fire.reset();
				};
			}
		};

		void launchFireworks();

		return () => {
			isCancelled = true;
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId);
			}
			cleanupFireworks?.();
		};
	}, []);

	return (
		<OnboardingStepLayout
			isDesktopMac={isDesktopMac}
			className="relative overflow-hidden"
			contentClassName="relative z-10"
			background={
				<canvas ref={canvasRef} className="onboarding-confetti-canvas" />
			}
		>
			<OnboardingStepCard
				title="You&apos;re in"
				description="Your account is ready. Let&apos;s set up your first workspace."
			>
				<Button className="w-full" onClick={onContinue} disabled={isSubmitting}>
					{isSubmitting ? (
						<LoaderCircle className="size-4 animate-spin" />
					) : null}
					Set up workspace
				</Button>
			</OnboardingStepCard>
		</OnboardingStepLayout>
	);
}

function AuthBootstrapScreen({
	isDesktopApp,
	isDesktopMac,
}: {
	isDesktopApp: boolean;
	isDesktopMac: boolean;
}) {
	return (
		<output
			data-app-region={isDesktopMac ? "drag" : undefined}
			className="fixed inset-0 grid place-items-center bg-background"
			aria-label="Loading Graneri"
		>
			{isDesktopApp ? (
				<GraneriMark
					className="app-loading-mark block size-[42px] text-foreground"
					data-app-region={isDesktopMac ? "no-drag" : undefined}
					shimmer
				/>
			) : null}
		</output>
	);
}

const getDesktopPermissionTone = (state: DesktopPermissionState) => {
	if (state === "granted") {
		return "border-transparent bg-muted text-foreground";
	}

	return "border-border bg-muted/40 text-muted-foreground";
};

const getDesktopPermissionIcon = (permissionId: DesktopPermissionId) =>
	permissionId === "microphone" ? Mic : Volume2;

const getDesktopPermissionActionLabel = (permissionId: DesktopPermissionId) =>
	DESKTOP_PERMISSION_BUTTON_LABELS[permissionId];

const getDesktopPermissionStateLabel = (permission: DesktopPermissionRow) => {
	if (permission.state === "granted") {
		return permission.id === "systemAudio" && !permission.canRequest
			? "Ready"
			: "Enabled";
	}

	if (permission.state === "unsupported") {
		return "Unavailable";
	}

	if (permission.state === "blocked") {
		return "Blocked";
	}

	if (permission.state === "prompt") {
		return "Needs access";
	}

	return "Unknown";
};

function DesktopPermissionsOnboardingScreen({
	error,
	activePermissionId,
	permissions,
	status,
	onContinue,
	onOpenSettings,
	onRequestPermission,
}: {
	error: string | null;
	activePermissionId: DesktopPermissionId | null;
	permissions: DesktopPermissionRow[];
	status: {
		isDesktopMac: boolean;
		isRefreshing: boolean;
		isSubmitting: boolean;
		canContinue: boolean;
	};
	onContinue: () => void;
	onOpenSettings: (permissionId: DesktopPermissionId) => void;
	onRequestPermission: (permissionId: DesktopPermissionId) => void;
}) {
	const { isDesktopMac, isRefreshing, isSubmitting, canContinue } = status;

	if (permissions.length === 0) {
		return null;
	}

	const isMicrophoneGranted = permissions.some(
		(permission) =>
			permission.id === "microphone" && permission.state === "granted",
	);

	return (
		<OnboardingStepLayout isDesktopMac={isDesktopMac}>
			<OnboardingStepCard
				title="Transcription permissions"
				description="When you turn it on, Graneri transcribes meetings using your computer's audio."
				contentClassName="flex flex-col gap-5"
			>
				<div>
					{permissions.map((permission) => {
						const Icon = getDesktopPermissionIcon(permission.id);
						const isRequestBlockedByDependency =
							permission.id === "systemAudio" && !isMicrophoneGranted;
						const isActionPending =
							isRefreshing && activePermissionId === permission.id;

						return (
							<React.Fragment key={permission.id}>
								<div className="flex items-center gap-3 p-4">
									<div
										className={cn(
											"flex size-10 shrink-0 items-center justify-center rounded-full border",
											getDesktopPermissionTone(permission.state),
										)}
									>
										<Icon className="size-4" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="font-medium whitespace-nowrap">
											{permission.label}
										</p>
									</div>
									{permission.state === "granted" ? (
										<div className="inline-flex size-9 items-center justify-center rounded-full border border-border/70">
											<Check className="size-4" />
										</div>
									) : permission.canRequest ? (
										<Button
											type="button"
											size="sm"
											className="shrink-0 rounded-full px-4 whitespace-nowrap"
											onClick={() => onRequestPermission(permission.id)}
											disabled={
												isRefreshing ||
												isSubmitting ||
												isRequestBlockedByDependency
											}
										>
											{isActionPending ? (
												<LoaderCircle className="size-4 animate-spin" />
											) : (
												<Icon className="size-4" />
											)}
											{getDesktopPermissionActionLabel(permission.id)}
										</Button>
									) : permission.canOpenSystemSettings ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											className="shrink-0 rounded-full px-4 whitespace-nowrap"
											onClick={() => onOpenSettings(permission.id)}
											disabled={isRefreshing || isSubmitting}
										>
											{isActionPending ? (
												<LoaderCircle className="size-4 animate-spin" />
											) : (
												<ExternalLink className="size-4" />
											)}
											Open settings
										</Button>
									) : (
										<div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
											<TriangleAlert className="size-4" />
											{getDesktopPermissionStateLabel(permission)}
										</div>
									)}
								</div>
							</React.Fragment>
						);
					})}
				</div>
				{error ? (
					<div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning-foreground">
						<TriangleAlert className="mt-0.5 size-4 shrink-0" />
						<p>{error}</p>
					</div>
				) : null}
				<Button
					type="button"
					onClick={onContinue}
					className="w-full"
					disabled={!canContinue || isSubmitting}
				>
					Review permissions
				</Button>
			</OnboardingStepCard>
		</OnboardingStepLayout>
	);
}

function WorkspaceOnboardingScreen({
	error,
	isDesktopMac,
	isSubmitting,
	name,
	onNameChange,
	onSubmit,
}: {
	error: string | null;
	isDesktopMac: boolean;
	isSubmitting: boolean;
	name: string;
	onNameChange: (value: string) => void;
	onSubmit: () => void;
}) {
	return (
		<OnboardingStepLayout isDesktopMac={isDesktopMac}>
			<OnboardingStepCard
				title="Create workspace"
				description="Set up your first workspace to continue."
			>
				<form>
					<div className="flex flex-col gap-5">
						<WorkspaceComposer
							name={name}
							onNameChange={onNameChange}
							error={error}
							nameInputId="onboarding-workspace-name"
						/>
						<Field>
							<Button
								className="w-full"
								onClick={onSubmit}
								disabled={isSubmitting || name.trim().length < 2}
							>
								Create workspace
							</Button>
						</Field>
					</div>
				</form>
			</OnboardingStepCard>
		</OnboardingStepLayout>
	);
}

export default App;
