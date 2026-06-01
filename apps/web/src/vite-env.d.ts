/// <reference types="vite/client" />

import "./canvas-confetti";
import "./electron";

declare global {
	interface ImportMetaEnv {
		readonly VITE_CONVEX_URL?: string;
		readonly VITE_CONVEX_SITE_URL?: string;
		readonly VITE_AUTH_PROVIDERS?: string;
		readonly VITE_DESKTOP_DOWNLOAD_URL?: string;
		readonly VITE_DESKTOP_RELEASE_API_URL?: string;
		readonly VITE_GITHUB_OWNER?: string;
		readonly VITE_GITHUB_REPO?: string;
		readonly VITE_PRIVACY_URL?: string;
		readonly VITE_TERMS_URL?: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}
}
