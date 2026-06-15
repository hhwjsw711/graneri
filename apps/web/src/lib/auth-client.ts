import { desktopAuthClient } from "./desktop-auth-client";
import type { AuthSession, GraneriAuthClient } from "./graneri-auth-client";
import { createWebGraneriAuthClient } from "./web-auth-client";

export let authClient!: GraneriAuthClient;

export type { AuthSession };

export function initializeAuthClient(baseURL: string, isDesktop = false) {
	authClient = isDesktop
		? desktopAuthClient
		: createWebGraneriAuthClient(baseURL);
	return authClient;
}
