import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { setDesktopNativeTheme } from "@workspace/platform/desktop";
import type { DesktopThemeSource } from "@workspace/platform/desktop-bridge";
import { Toaster } from "@workspace/ui/components/sonner";
import {
	ThemeProvider,
	useTheme,
} from "@workspace/ui/components/theme-provider";
import { ScrollRailVisibilityProvider } from "@workspace/ui/lib/scroll-rail";
import App from "./App.tsx";
import { MeetingWidgetScreen } from "./components/desktop/meeting-widget-screen";
import { initializeAuthClient } from "./lib/auth-client";
import { initializeConvexClient } from "./lib/convex";
import { installNavigationHistoryState } from "./lib/navigation-history-state";
import { loadRuntimeConfig } from "./lib/runtime-config";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element #root was not found");
}

const root = createRoot(rootElement);
const meetingWidgetPathname = "/desktop/meeting-widget";

const isMeetingWidgetRoute = () =>
	typeof window !== "undefined" &&
	window.location.pathname === meetingWidgetPathname;

installNavigationHistoryState();

const syncDesktopNativeTheme = (theme: DesktopThemeSource) => {
	void setDesktopNativeTheme(theme).catch((error: unknown) => {
		console.error("Failed to sync native desktop theme", error);
	});
};

function DesktopNativeThemeSync() {
	const { theme } = useTheme();

	useEffect(() => {
		syncDesktopNativeTheme(theme);
	}, [theme]);

	return null;
}

async function bootstrap() {
	if (isMeetingWidgetRoute()) {
		root.render(
			<StrictMode>
				<ThemeProvider>
					<DesktopNativeThemeSync />
					<ScrollRailVisibilityProvider />
					<MeetingWidgetScreen />
				</ThemeProvider>
			</StrictMode>,
		);
		return;
	}

	const runtimeConfig = await loadRuntimeConfig();

	const convex = initializeConvexClient(runtimeConfig.convexUrl);
	const authClient = initializeAuthClient(
		runtimeConfig.convexSiteUrl,
		runtimeConfig.isDesktop,
	);

	root.render(
		<StrictMode>
			<ConvexBetterAuthProvider client={convex} authClient={authClient}>
				<ThemeProvider>
					<DesktopNativeThemeSync />
					<ScrollRailVisibilityProvider />
					<App />
					<Toaster />
				</ThemeProvider>
			</ConvexBetterAuthProvider>
		</StrictMode>,
	);
}

void bootstrap();
