import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateZoomMcpConnection } from "../packages/ai/src/zoom-mcp-tools.mjs";
import { oauthCallbackHtmlResponse } from "./oauthCallbackHtml";

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const getConvexSiteUrl = () => process.env.CONVEX_SITE_URL?.trim() ?? "";

const getRedirectUri = () => `${getConvexSiteUrl()}/api/oauth/zoom/callback`;

type ZoomTokenResponse = {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
};

const exchangeZoomOAuthCode = async ({
	clientId,
	clientSecret,
	code,
	redirectUri,
}: {
	clientId: string;
	clientSecret: string;
	code: string;
	redirectUri: string;
}) => {
	const tokenUrl = new URL("https://zoom.us/oauth/token");
	tokenUrl.searchParams.set("grant_type", "authorization_code");
	tokenUrl.searchParams.set("code", code);
	tokenUrl.searchParams.set("redirect_uri", redirectUri);

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
		},
	});

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			`Zoom OAuth token exchange failed (${response.status}).${responseText ? ` ${responseText}` : ""}`,
		);
	}

	const tokenResponse = (await response.json()) as ZoomTokenResponse;

	if (typeof tokenResponse.access_token !== "string") {
		throw new Error("Zoom OAuth token exchange did not return an access token.");
	}

	return {
		accessToken: tokenResponse.access_token,
		refreshToken:
			typeof tokenResponse.refresh_token === "string"
				? tokenResponse.refresh_token
				: undefined,
		expiresIn:
			typeof tokenResponse.expires_in === "number"
				? tokenResponse.expires_in
				: undefined,
	};
};

export const handleZoomOAuthCallbackRequest = async (
	ctx: ActionCtx,
	request: Request,
) => {
	const url = new URL(request.url);
	const code = url.searchParams.get("code")?.trim();
	const state = url.searchParams.get("state")?.trim();
	const error = url.searchParams.get("error")?.trim();

	if (error) {
		return oauthCallbackHtmlResponse("Zoom connection failed", error, 400);
	}

	if (!code || !state) {
		return jsonResponse({ message: "Missing Zoom OAuth code or state." }, 400);
	}

	const pendingState = await ctx.runMutation(
		internal.appConnections.consumeMcpOAuthState,
		{ provider: "zoom", state },
	);

	if (!pendingState || pendingState.expiresAt < Date.now()) {
		return oauthCallbackHtmlResponse("Zoom connection expired", "Start the Zoom connection again.", 400);
	}

	if (!pendingState.oauthClientSecret) {
		return oauthCallbackHtmlResponse(
			"Zoom connection failed",
			"Zoom OAuth client secret is missing.",
			500,
		);
	}

	const redirectUri = getRedirectUri();
	if (!redirectUri.startsWith("http")) {
		return oauthCallbackHtmlResponse("Zoom connection failed", "CONVEX_SITE_URL is not configured.", 500);
	}

	try {
		const tokens = await exchangeZoomOAuthCode({
			clientId: pendingState.oauthClientId,
			clientSecret: pendingState.oauthClientSecret,
			code,
			redirectUri,
		});
		const env = pendingState.envJson
			? (JSON.parse(pendingState.envJson) as Record<string, string>)
			: undefined;

		await validateZoomMcpConnection({
			baseUrl: pendingState.baseUrl,
			...(env ? { env } : {}),
			oauthClientId: pendingState.oauthClientId,
			oauthAccessToken: tokens.accessToken,
		});

		await ctx.runMutation(internal.appConnections.upsertZoom, {
			ownerTokenIdentifier: pendingState.ownerTokenIdentifier,
			workspaceId: pendingState.workspaceId,
			displayName: pendingState.displayName,
			baseUrl: pendingState.baseUrl,
			...(env ? { env } : {}),
			oauthClientId: pendingState.oauthClientId,
			oauthClientSecret: pendingState.oauthClientSecret,
			oauthAccessToken: tokens.accessToken,
			...(tokens.refreshToken ? { oauthRefreshToken: tokens.refreshToken } : {}),
			...(tokens.expiresIn
				? { tokenExpiresAt: Date.now() + tokens.expiresIn * 1000 }
				: {}),
		});
	} catch (connectionError) {
		console.error("Failed to complete Zoom OAuth connection", connectionError);
		return oauthCallbackHtmlResponse(
			"Zoom connection failed",
			"OpenGran could not complete the Zoom connection.",
			500,
		);
	}

	return oauthCallbackHtmlResponse("Zoom connected", "You can close this window and return to OpenGran.");
};
