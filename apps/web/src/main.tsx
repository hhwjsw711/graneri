import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { setDesktopNativeTheme } from "@workspace/platform/desktop";
import type { DesktopThemeSource } from "@workspace/platform/desktop-bridge";
import { rendererMeetingWidgetPathname } from "@workspace/platform/renderer-routes";
import { Toaster } from "@workspace/ui/components/sonner";
import {
	ThemeProvider,
	useTheme,
} from "@workspace/ui/components/theme-provider";
import { ScrollRailVisibilityProvider } from "@workspace/ui/lib/scroll-rail";
import { logError } from "@/lib/logger";
import App from "./App.tsx";
import { MeetingWidgetScreen } from "./components/desktop/meeting-widget-screen";
import { initializeAuthClient } from "./lib/auth-client";
import { initializeConvexClient } from "./lib/convex";
import { GraneriConvexAuthProvider } from "./lib/graneri-convex-auth-provider";
import { installNavigationHistoryState } from "./lib/navigation-history-state";
import { loadRuntimeConfig } from "./lib/runtime-config";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element #root was not found");
}

const root = createRoot(rootElement);

const isMeetingWidgetRoute = () =>
	typeof window !== "undefined" &&
	window.location.pathname === rendererMeetingWidgetPathname;

installNavigationHistoryState();

const syncDesktopNativeTheme = (theme: DesktopThemeSource) => {
	void setDesktopNativeTheme(theme).catch((error: unknown) => {
		logError({
			event: "client.error",
			error: error,
			message: "Failed to sync native desktop theme",
		});
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
	initializeAuthClient(runtimeConfig.convexSiteUrl, runtimeConfig.isDesktop);

	root.render(
		<StrictMode>
			<GraneriConvexAuthProvider client={convex}>
				<ThemeProvider>
					<DesktopNativeThemeSync />
					<ScrollRailVisibilityProvider />
					<App />
					<Toaster />
				</ThemeProvider>
			</GraneriConvexAuthProvider>
		</StrictMode>,
	);
}

void bootstrap();
