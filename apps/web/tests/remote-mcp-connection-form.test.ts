import { describe, expect, it } from "vitest";
import {
	buildRemoteMcpConnectArgs,
	isRemoteMcpConnectionFormValid,
} from "@/lib/remote-mcp-connection-form";
import type { Id } from "../../../convex/_generated/dataModel";

const workspaceId = "workspace-1" as Id<"workspaces">;

describe("remote MCP connection form", () => {
	it("builds trimmed connect args with non-empty env vars and OAuth fields", () => {
		const args = buildRemoteMcpConnectArgs({
			workspaceId,
			requireEnvValue: true,
			formState: {
				name: "  PostHog  ",
				baseUrl: "  https://mcp.posthog.com/mcp  ",
				envVars: [
					{ id: "1", key: "  Authorization  ", value: "Bearer token" },
					{ id: "2", key: "EMPTY", value: "" },
					{ id: "3", key: "   ", value: "ignored" },
				],
				oauthClientId: "  client-id  ",
				oauthClientSecret: "  client-secret  ",
			},
		});

		expect(args).toEqual({
			workspaceId,
			displayName: "PostHog",
			baseUrl: "https://mcp.posthog.com/mcp",
			env: {
				Authorization: "Bearer token",
			},
			oauthClientId: "client-id",
			oauthClientSecret: "client-secret",
		});
	});

	it("keeps key-only env vars when provider env values are optional", () => {
		const args = buildRemoteMcpConnectArgs({
			workspaceId,
			requireEnvValue: false,
			formState: {
				name: "Figma",
				baseUrl: "https://mcp.figma.com/mcp",
				envVars: [{ id: "1", key: "FIGMA_API_URL", value: "" }],
				oauthClientId: "",
				oauthClientSecret: "   ",
			},
		});

		expect(args).toEqual({
			workspaceId,
			displayName: "Figma",
			baseUrl: "https://mcp.figma.com/mcp",
			env: {
				FIGMA_API_URL: "",
			},
		});
	});

	it("validates name and base URL as the form interface", () => {
		expect(
			isRemoteMcpConnectionFormValid({
				name: "Context7",
				baseUrl: "https://mcp.context7.com/mcp",
				envVars: [],
			}),
		).toBe(true);
		expect(
			isRemoteMcpConnectionFormValid({
				name: " ",
				baseUrl: "https://mcp.context7.com/mcp",
				envVars: [],
			}),
		).toBe(false);
		expect(
			isRemoteMcpConnectionFormValid({
				name: "Context7",
				baseUrl: " ",
				envVars: [],
			}),
		).toBe(false);
	});
});
